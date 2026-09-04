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
//
// THIS IS THE FIX for "respawn happens immediately, downed state is skipped":
// when a player dies, the server discards that Player object and constructs
// a brand new one for the respawn. persistentData written on the entity that
// died does NOT automatically transfer to that new entity — it has to be
// copied across explicitly, which is exactly what this event is for.
PlayerEvents.cloned(event => {
    if (CFG.debug) {
        console.log(`[DownedSystem] cloned event fired — available keys: ${Object.keys(event).join(', ')}`)
    }

    // Best-guess field names — if this logs an error below about
    // oldPlayer/player being undefined, check the key list printed
    // above and swap in the correct property names.
    const oldPlayer = event.oldPlayer
    const newPlayer = event.player

    if (!oldPlayer || !newPlayer) {
        console.log('[DownedSystem] ERROR: cloned event fired but oldPlayer/player were undefined — check key list above and fix field names')
        return
    }

    newPlayer.persistentData.putInt('hearts_lost', oldPlayer.persistentData.getInt('hearts_lost'))
    newPlayer.persistentData.putInt('hearts_gained', oldPlayer.persistentData.getInt('hearts_gained'))
    newPlayer.persistentData.putBoolean('awaiting_revive', oldPlayer.persistentData.getBoolean('awaiting_revive'))
    newPlayer.persistentData.putLong('revive_deadline_tick', oldPlayer.persistentData.getLong('revive_deadline_tick'))
    newPlayer.persistentData.putDouble('death_x', oldPlayer.persistentData.getDouble('death_x'))
    newPlayer.persistentData.putDouble('death_y', oldPlayer.persistentData.getDouble('death_y'))
    newPlayer.persistentData.putDouble('death_z', oldPlayer.persistentData.getDouble('death_z'))
    newPlayer.persistentData.putString('death_dim', oldPlayer.persistentData.getString('death_dim'))

    debugLog(`cloned: carried awaiting_revive=${newPlayer.persistentData.getBoolean('awaiting_revive')}, hearts_lost=${newPlayer.persistentData.getInt('hearts_lost')}`, newPlayer)
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
    // NOTE: same Java-interop gotcha as `.overworld` above — if this
    // line errors with a similar "not a function" message, try
    // `player.level.dimension().toString()` instead.
    player.persistentData.putString('death_dim', player.level.dimension.toString())
}

function isAwaitingRevive(player) {
    return player.persistentData.getBoolean('awaiting_revive')
}

function beginDownedWindow(player) {
    player.persistentData.putBoolean('awaiting_revive', true)
    player.persistentData.putLong('revive_deadline_tick', player.server.tickCount + CFG.reviveWindowSeconds * 20)
}

function endDownedWindow(player) {
    player.persistentData.putBoolean('awaiting_revive', false)
}

// ---------- boss bar countdown ----------
// Renders even over the vanilla death screen, so the player sees the
// countdown before they even click Respawn — this is what communicates
// "clicking Respawn won't get you back early" without needing to touch
// the (unmoddable via KubeJS) vanilla death screen UI itself.
//
// Implemented via vanilla /bossbar commands rather than a Java API call,
// since command syntax is stable across versions — safer than guessing
// another wrapper method name after three wrong guesses already this
// session. Wrapped in try/catch with console logging so a bad guess here
// fails loudly instead of silently, same as everywhere else in this file.

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
// Built as a JS object and JSON.stringify'd rather than hand-written JSON
// in a template string — avoids quote-escaping bugs entirely.
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
                    // NOTE: some MC versions (1.20.5+) changed hoverEvent's
                    // "value" field to require a full component object
                    // rather than a plain string — if the hover tooltip
                    // doesn't show, that's the first thing to check.
                    value: { text: 'Hold right-click on their grave to revive them.' }
                }
            },
            { text: '!' }
        ]
    }
    runCmd(player.server, `tellraw @a ${JSON.stringify(msg)}`)
}

// ---------- admin health adjustment (additive, used by /downed add_health) ----------
// Adds heartsDelta hearts (can be negative) on top of whatever the player
// currently has. Stored in the same hearts_gained field Health Tokens use,
// so it persists and survives login the same way. Floor-clamped to
// CFG.minHearts so an admin can't accidentally push someone to 0 or
// negative max health; deliberately NOT ceiling-clamped to the normal
// token cap, since this is an admin override, not a token pickup.
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

// Find the nearest downed player to a given entity, within range,
// searching by their stored death position (works with or without
// Gravestones, since the grave spawns at the same spot as death).
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

    // NOTE: exact accessor for "vanilla respawn position (bed/anchor,
    // falling back to world spawn)" — confirmed via KubeJS source that
    // the underlying method is `kjs$getSpawnLocation()` on ServerPlayerKJS,
    // which returns a nullable LevelBlock. KubeJS typically exposes
    // kjs$-prefixed default methods as bean properties with the prefix
    // stripped, so `player.spawnLocation` is the best-guess mapping —
    // confirmed or corrected by the debug key-dump below. A null result
    // is CORRECT (not a failure) for a player with no bed/respawn anchor
    // set — it means "use world spawn", which is the fallback already
    // in place.
    //
    // Teleport is done via the vanilla /tp command rather than
    // player.teleportTo(...) directly: that Java method is overloaded in
    // a way Rhino can't reliably disambiguate for mixed double/float
    // numeric args, so routing through a command sidesteps the
    // reflection ambiguity entirely — same approach as the boss bar.
    // Rotation (yaw/pitch) is deliberately omitted from the command below
    // since player.yRot/xRot were unconfirmed guesses too, and a single
    // bad argument silently breaks the whole command's parsing.
    let dimId = 'minecraft:overworld'
    let pos = player.server.overworld().sharedSpawnPos

    try {
        var spawnLoc = player.spawnLocation
        if (CFG.debug) {
            console.log(`[DownedSystem] player.spawnLocation = ${spawnLoc}`)
            if (spawnLoc) console.log(`[DownedSystem] spawnLocation keys: ${Object.keys(spawnLoc).join(', ')}`)
        }
        if (spawnLoc) {
            // Field names below are a best guess pending confirmation
            // from the key dump above — adjust if teleport still doesn't
            // land at the right spot after this.
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
    // No max-health penalty on a successful revive — that's the point.
    player.tell(Text.green('You have been revived!'))
}

// ---------- death / respawn hooks ----------

// EntityEvents.death fires for any entity, so we filter to players.
// event.source is the DamageSourceJS wrapper; .entity is the best guess
// for "who/what caused the damage" — if killer detection below never
// works for player-vs-player kills, check the logged key list to find
// the correct field name.
EntityEvents.death(event => {
    const player = event.entity
    if (!player.isPlayer()) return

    storeDeathPos(player)
    beginDownedWindow(player) // must be TRUE before respawned fires and checks it
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
    debugLog(`respawned event fired — awaiting_revive=${isAwaitingRevive(player)}`, player)

    // If this respawn was triggered BY finalizeDeath() / an admin
    // /revive-adjacent flow, awaiting_revive is already false — let
    // it proceed as a completely normal respawn.
    if (!isAwaitingRevive(player)) {
        debugLog('respawned: awaiting_revive is false, letting real respawn proceed unmodified', player)
        return
    }

    // This is the initial vanilla respawn right after death: hijack
    // it, drop the player into spectator at their death point, and
    // start the window instead of letting them actually respawn yet.
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
        const level = event.server.overworld() // adjust if cross-dimension deaths matter to you

        level.spawnParticles('minecraft:soul', false, x + 0.5, y + 0.5, z + 0.5, 3, 0.3, 0.5, 0.3, 0.02)

        const remaining = Math.floor((player.persistentData.getLong('revive_deadline_tick') - event.server.tickCount) / 20)
        updateBossbar(player, remaining)
        debugLog(`tick check: ${player.username} awaiting_revive, ${remaining}s remaining`) // console only, no chat spam

        if (event.server.tickCount >= player.persistentData.getLong('revive_deadline_tick')) {
            finalizeDeath(player)
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

// Gravestones present: right-clicking the grave block itself targets it.
// NOTE: this assumes the grave block's registry id is
// "gravestones:grave" and that ownership can be resolved by proximity
// to a stored death position rather than reading Gravestones' own NBT
// schema (whose exact field names for the owning player weren't
// verified here). If you want a tighter check — e.g. confirming the
// right-clicked grave actually belongs to the nearest downed player
// rather than just "some downed player is nearby" — inspect the grave
// block entity's NBT in-game (F3+I on the block, or their API/docs)
// and match on that instead.
if (GRAVESTONES_LOADED) {
    BlockEvents.rightClicked('gravestones:grave', event => {
        if (event.item.id !== 'kubejs:revival_token') return
        const target = findNearestDowned(event.server, event.block.pos, CFG.reviveRangeGravestones)
        if (!target) {
            event.player.tell(Text.gray('No one buried nearby is waiting to be revived.'))
            event.cancel()
        }
        // if a target exists, do nothing further here — vanilla's
        // useDuration/finishUsingItem flow (registered below) takes over
    })
}

// No Gravestones: right-clicking in the air near the death particles targets it.
ItemEvents.rightClicked('kubejs:revival_token', event => {
    if (GRAVESTONES_LOADED) return // handled by the block hook above instead
    const target = findNearestDowned(event.server, event.entity, CFG.reviveRangeNoGravestones)
    if (!target) {
        event.entity.tell(Text.gray('No one nearby is waiting to be revived.'))
    }
    // let use-duration tracking begin regardless — re-validated on finish
})

// ---------- Revival Token: completion after the hold duration ----------
//
// The actual completion trigger lives in the ITEM BUILDER, not here
// (ItemEvents.finishedUsing doesn't exist as a standalone server_scripts
// event in this KubeJS version — .finishUsing() on the item definition
// itself is the correct hook). See startup_scripts/downed_system/01_items.js.
// That callback runs at in-game use-time (long after both scripts have
// loaded), so it's safe for it to call this function via the global
// namespace even though items.js is a startup_script and this is a
// server_script.
function completeRevive(itemstack, level, entity) {
    if (!entity.isPlayer || !entity.isPlayer()) return itemstack
    const reviver = entity
    const server = reviver.server
    const range = GRAVESTONES_LOADED ? CFG.reviveRangeGravestones : CFG.reviveRangeNoGravestones
    const target = findNearestDowned(server, reviver, range)
    if (!target) return itemstack // target left range, or was already revived by someone else mid-channel

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
