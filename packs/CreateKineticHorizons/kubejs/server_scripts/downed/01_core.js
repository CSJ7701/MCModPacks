// ============================================================
// DOWNED SYSTEM — CORE LOGIC
// Flow: real death happens -> Gravestones (if installed) does its
// own thing on the vanilla death event, untouched by us -> vanilla
// respawn fires -> we intercept THAT to park the player in spectator
// at their death point -> timer runs -> either revived by another
// player, or the window expires and we let the real respawn through
// with a max-health penalty + debuffs.
// ============================================================

const CFG = global.DownedSystem.Config
const GRAVESTONES_LOADED = Platform.isLoaded('gravestones')

function debugLog(msg, player) {
    if (!CFG.debug) return
    console.log(`[DownedSystem] ${msg}`)
    if (CFG.debugChatMessages && player) {
        player.tell(Text.gray(`[DownedSystem] ${msg}`))
    }
}

// ---------- carry persistent data across the death->respawn entity swap ----------
PlayerEvents.cloned(event => {
    if (CFG.debug) {
        console.log(`[DownedSystem] cloned event fired — available keys: ${Object.keys(event).join(', ')}`)
    }

    const oldPlayer = event.oldPlayer
    const newPlayer = event.player

    if (!oldPlayer || !newPlayer) {
        console.log('[DownedSystem] ERROR: cloned event fired but oldPlayer/player were undefined — check key list above and fix field names')
        return
    }

    // Standard persistent attributes
    newPlayer.persistentData.putInt('hearts_lost', oldPlayer.persistentData.getInt('hearts_lost'))
    newPlayer.persistentData.putInt('hearts_gained', oldPlayer.persistentData.getInt('hearts_gained'))
    newPlayer.persistentData.putBoolean('awaiting_revive', oldPlayer.persistentData.getBoolean('awaiting_revive'))
    newPlayer.persistentData.putLong('revive_deadline_tick', oldPlayer.persistentData.getLong('revive_deadline_tick'))
    newPlayer.persistentData.putDouble('death_x', oldPlayer.persistentData.getDouble('death_x'))
    newPlayer.persistentData.putDouble('death_y', oldPlayer.persistentData.getDouble('death_y'))
    newPlayer.persistentData.putDouble('death_z', oldPlayer.persistentData.getDouble('death_z'))
    newPlayer.persistentData.putString('death_dim', oldPlayer.persistentData.getString('death_dim'))

    // State tracking flags for deferred respawn/bleedout
    newPlayer.persistentData.putBoolean('respawned', oldPlayer.persistentData.getBoolean('respawned'))
    newPlayer.persistentData.putBoolean('pending_bleedout', oldPlayer.persistentData.getBoolean('pending_bleedout'))

    debugLog(`cloned: carried awaiting_revive=${newPlayer.persistentData.getBoolean('awaiting_revive')}, pending_bleedout=${newPlayer.persistentData.getBoolean('pending_bleedout')}`, newPlayer)
})

// ---------- helpers ----------

function applyMaxHealth(player) {
    const lost = player.persistentData.getInt('hearts_lost')
    const gained = player.persistentData.getInt('hearts_gained')
    const target = 20 - lost + gained
    player.getAttribute('minecraft:generic.max_health').baseValue = target
    if (player.health > target) player.health = target
}

function reduceMaxHealth(player) {
    const maxLossAllowed = 20 - CFG.minHearts * 2 // in half-hearts (HP)
    const lost = Math.min(player.persistentData.getInt('hearts_lost') + 1, maxLossAllowed)
    player.persistentData.putInt('hearts_lost', lost)
    applyMaxHealth(player)
}

function grantMaxHealth(player, halfHearts) {
    const cap = CFG.maxBonusHeartsFromTokens * 2
    const gained = Math.min(player.persistentData.getInt('hearts_gained') + halfHearts, cap)
    player.persistentData.putInt('hearts_gained', gained)
    applyMaxHealth(player)
}

function storeDeathPos(player) {
    player.persistentData.putDouble('death_x', player.x)
    player.persistentData.putDouble('death_y', player.y)
    player.persistentData.putDouble('death_z', player.z)
    player.persistentData.putString('death_dim', player.level.dimension.toString())
}

function isAwaitingRevive(player) {
    return player.persistentData.getBoolean('awaiting_revive')
}

function beginDownedWindow(player) {
    player.persistentData.putBoolean('awaiting_revive', true)
    player.persistentData.putBoolean('respawned', false)
    player.persistentData.putBoolean('pending_bleedout', false)
    player.persistentData.putLong('revive_deadline_tick', player.server.tickCount + CFG.reviveWindowSeconds * 20)
}

function endDownedWindow(player) {
    player.persistentData.putBoolean('awaiting_revive', false)
    player.persistentData.putBoolean('pending_bleedout', false)
}

// ---------- boss bar countdown ----------

function bossbarId(player) {
    return 'downed_p' + player.stringUuid
}

function runCmd(server, cmd) {
    if (CFG.debug) console.log(`[DownedSystem] running command: ${cmd}`)
    try {
        server.runCommandSilent(cmd)
    } catch (e) {
        console.log(`[DownedSystem] ERROR running command "${cmd}": ${e}`)
    }
}

function createBossbar(player) {
    const id = bossbarId(player)
    const server = player.server
    runCmd(server, `bossbar add ${id} {"text":"Downed"}`)
    runCmd(server, `bossbar set ${id} players ${player.username}`)
    runCmd(server, `bossbar set ${id} color red`)
    runCmd(server, `bossbar set ${id} max ${CFG.reviveWindowSeconds}`)
    runCmd(server, `bossbar set ${id} value ${CFG.reviveWindowSeconds}`)
}

function updateBossbar(player, remainingSeconds) {
    const id = bossbarId(player)
    const server = player.server
    const clamped = Math.max(remainingSeconds, 0)
    runCmd(server, `bossbar set ${id} value ${clamped}`)
    runCmd(server, `bossbar set ${id} name {"text":"Downed — respawn available in ${clamped}s","color":"red"}`)
}

function removeBossbar(player) {
    runCmd(player.server, `bossbar remove ${bossbarId(player)}`)
}

// ---------- global chat announcement on downing ----------
function announceDowned(player) {
    const msg = {
        text: '',
        extra: [
            { text: player.username, color: 'gold', bold: true },
            { text: ' has been downed at ' },
            { text: `(${Math.floor(player.x)}, ${Math.floor(player.y)}, ${Math.floor(player.z)})`, color: 'yellow' },
            { text: '! Revive them with a ' },
            {
                text: 'Revival Token',
                color: 'light_purple',
                bold: true,
                hoverEvent: {
                    action: 'show_text',
                    value: { text: 'Hold right-click on their grave to revive them.' }
                }
            },
            { text: '!' }
        ]
    }
    runCmd(player.server, `tellraw @a ${JSON.stringify(msg)}`)
}

function adminAddHealth(player, heartsDelta) {
    const halfHearts = heartsDelta * 2
    const gained = player.persistentData.getInt('hearts_gained') + halfHearts
    player.persistentData.putInt('hearts_gained', gained)
    applyMaxHealth(player)

    const attr = player.getAttribute('minecraft:generic.max_health')
    const floor = CFG.minHearts * 2
    if (attr.baseValue < floor) {
        const correction = floor - attr.baseValue
        player.persistentData.putInt('hearts_gained', gained + correction)
        applyMaxHealth(player)
    }
}

function findNearestDowned(server, near, range) {
    let best = null
    let bestDist = range * range
    server.players.forEach(p => {
        if (!isAwaitingRevive(p)) return
        const dx = p.persistentData.getDouble('death_x') - near.x
        const dy = p.persistentData.getDouble('death_y') - near.y
        const dz = p.persistentData.getDouble('death_z') - near.z
        const d2 = dx * dx + dy * dy + dz * dz
        if (d2 <= bestDist) {
            bestDist = d2
            best = p
        }
    })
    return best
}

function finalizeDeath(player) {
    debugLog(`finalizeDeath firing for ${player.username}`, player)
    removeBossbar(player)
    reduceMaxHealth(player)
    endDownedWindow(player)
    player.setGameMode('survival')

    let dimId = 'minecraft:overworld'
    let pos = player.server.overworld().sharedSpawnPos

    try {
        var spawnLoc = player.spawnLocation
        if (CFG.debug) {
            console.log(`[DownedSystem] player.spawnLocation = ${spawnLoc}`)
            if (spawnLoc) console.log(`[DownedSystem] spawnLocation keys: ${Object.keys(spawnLoc).join(', ')}`)
        }
        if (spawnLoc) {
            if (spawnLoc.pos) pos = spawnLoc.pos
            if (spawnLoc.level && spawnLoc.level.dimension) {
                dimId = String(spawnLoc.level.dimension)
            }
        }
    } catch (e) {
        console.log(`[DownedSystem] ERROR reading player.spawnLocation: ${e}`)
    }

    runCmd(player.server, `execute in ${dimId} run tp ${player.username} ${pos.x + 0.5} ${pos.y} ${pos.z + 0.5}`)

    player.potionEffects.add('minecraft:blindness', CFG.respawnDebuffs.blindnessTicks, 0)
    player.potionEffects.add('minecraft:nausea', CFG.respawnDebuffs.nauseaTicks, 0)
    player.potionEffects.add('minecraft:weakness', CFG.respawnDebuffs.weaknessTicks, CFG.respawnDebuffs.weaknessAmplifier)

    player.tell(Text.red('You bled out. -1 max heart.'))
}

function reviveSuccess(player, reviverPos) {
    debugLog(`reviveSuccess firing for ${player.username}`, player)
    removeBossbar(player)
    endDownedWindow(player)
    player.setGameMode('survival')
    player.teleportTo(reviverPos.x, reviverPos.y, reviverPos.z)
    player.health = player.maxHealth * 0.5
    player.potionEffects.add('minecraft:regeneration', 100, 1)
    player.tell(Text.green('You have been revived!'))
}

// ---------- death / respawn hooks ----------

EntityEvents.death(event => {
    const player = event.entity
    if (!player.isPlayer()) return

    storeDeathPos(player)
    beginDownedWindow(player)
    createBossbar(player)
    announceDowned(player)
    debugLog(`death event: stored pos (${player.x.toFixed(1)}, ${player.y.toFixed(1)}, ${player.z.toFixed(1)}), awaiting_revive=${isAwaitingRevive(player)}`, player)

    if (Math.random() < CFG.headDropChance) {
        const killer = event.source && event.source.entity
        if (CFG.debug && event.source) {
            console.log(`[DownedSystem] death source keys: ${Object.keys(event.source).join(', ')}`)
        }
        if (killer && killer.isPlayer && killer.isPlayer()) {
            const head = Item.of('minecraft:player_head')
            head.nbt.putString('SkullOwner', player.username)
            player.level.spawnItem(head, player.x, player.y, player.z)
        }
    }
})

PlayerEvents.respawned(event => {
    const player = event.player
    player.persistentData.putBoolean('respawned', true)

    debugLog(`respawned event fired — awaiting_revive=${isAwaitingRevive(player)}, pending_bleedout=${player.persistentData.getBoolean('pending_bleedout')}`, player)

    // Check if the timer expired while the player was on the death screen
    if (player.persistentData.getBoolean('pending_bleedout')) {
        debugLog('respawned: pending_bleedout is true, finalizing death now', player)
        finalizeDeath(player)
        return
    }

    // Normal behavior if awaiting revive
    if (!isAwaitingRevive(player)) {
        debugLog('respawned: awaiting_revive is false, letting real respawn proceed unmodified', player)
        return
    }

    const x = player.persistentData.getDouble('death_x')
    const y = player.persistentData.getDouble('death_y')
    const z = player.persistentData.getDouble('death_z')
    debugLog(`respawned: hijacking to spectator at (${x.toFixed(1)}, ${y.toFixed(1)}, ${z.toFixed(1)})`, player)
    player.setGameMode('spectator')
    player.teleportTo(x, y, z)
})

PlayerEvents.loggedIn(event => applyMaxHealth(event.player))

// ---------- tick loop: particles + timeout ----------

ServerEvents.tick(event => {
    if (event.server.tickCount % 20 !== 0) return // once per second

    event.server.players.forEach(player => {
        if (!isAwaitingRevive(player)) return

        const x = player.persistentData.getDouble('death_x')
        const y = player.persistentData.getDouble('death_y')
        const z = player.persistentData.getDouble('death_z')
        const level = event.server.overworld()

        level.spawnParticles('minecraft:soul', false, x + 0.5, y + 0.5, z + 0.5, 3, 0.3, 0.5, 0.3, 0.02)

        const remaining = Math.floor((player.persistentData.getLong('revive_deadline_tick') - event.server.tickCount) / 20)
        updateBossbar(player, remaining)
        debugLog(`tick check: ${player.username} awaiting_revive, ${remaining}s remaining`)

        if (event.server.tickCount >= player.persistentData.getLong('revive_deadline_tick')) {
            const hasRespawned = player.persistentData.getBoolean('respawned')
            
            if (hasRespawned) {
                // Player clicked respawn earlier and is sitting in spectator mode
                finalizeDeath(player)
            } else {
                // Player has not pressed "Respawn" on the vanilla death screen yet
                debugLog(`timer expired while ${player.username} is still on death screen. Setting pending_bleedout=true`, player)
                removeBossbar(player)
                endDownedWindow(player)
                player.persistentData.putBoolean('pending_bleedout', true)
            }
        }
    })
})

// ---------- Health Token consumption ----------

ItemEvents.rightClicked('kubejs:health_token', event => {
    const player = event.entity
    const cap = CFG.maxBonusHeartsFromTokens * 2
    if (player.persistentData.getInt('hearts_gained') >= cap) {
        player.tell(Text.gray('You are already at maximum health capacity.'))
        return
    }
    grantMaxHealth(player, CFG.heartsPerToken * 2)
    player.tell(Text.aqua(`+${CFG.heartsPerToken} max heart!`))
    if (!player.isCreative()) event.item.shrink(1)
    event.level.playSound(null, player.blockPosition(), 'minecraft:entity.player.levelup', 'players', 1, 1.4)
})

// ---------- Revival Token: targeting ----------

if (GRAVESTONES_LOADED) {
    BlockEvents.rightClicked('gravestones:grave', event => {
        if (event.item.id !== 'kubejs:revival_token') return
        const target = findNearestDowned(event.server, event.block.pos, CFG.reviveRangeGravestones)
        if (!target) {
            event.player.tell(Text.gray('No one buried nearby is waiting to be revived.'))
            event.cancel()
        }
    })
}

ItemEvents.rightClicked('kubejs:revival_token', event => {
    if (GRAVESTONES_LOADED) return
    const target = findNearestDowned(event.server, event.entity, CFG.reviveRangeNoGravestones)
    if (!target) {
        event.entity.tell(Text.gray('No one nearby is waiting to be revived.'))
    }
})

// ---------- Revival Token: completion after the hold duration ----------

function completeRevive(itemstack, level, entity) {
    if (!entity.isPlayer || !entity.isPlayer()) return itemstack
    const reviver = entity
    const server = reviver.server
    const range = GRAVESTONES_LOADED ? CFG.reviveRangeGravestones : CFG.reviveRangeNoGravestones
    const target = findNearestDowned(server, reviver, range)
    if (!target) return itemstack

    reviveSuccess(target, reviver.position())
    if (!reviver.isCreative()) itemstack.shrink(1)
    level.playSound(null, reviver.blockPosition(), 'minecraft:entity.player.levelup', 'players', 1, 1)
    return itemstack
}

global.DownedSystem.Helpers = {
    findNearestDowned: findNearestDowned,
    completeRevive: completeRevive,
    isAwaitingRevive: isAwaitingRevive,
    endDownedWindow: endDownedWindow,
    removeBossbar: removeBossbar,
    adminAddHealth: adminAddHealth
}
