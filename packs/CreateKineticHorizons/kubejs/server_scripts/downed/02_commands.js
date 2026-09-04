// ============================================================
// ADMIN COMMANDS — consolidated under /downed
// /downed revive <player>
// /downed add_health <player> <hearts>   (additive, can be negative)
// /downed config get <option>
// /downed config set <option> <value>
// All require permission level 2 (standard "op" gate).
// ============================================================

const Helpers = global.DownedSystem.Helpers
const Config = global.DownedSystem.Config

// Whitelist of top-level config keys the /downed config command is
// allowed to touch, along with their type, so `set` can parse the raw
// string argument correctly. Nested keys (respawnDebuffs.*) are left
// out for simplicity — edit 00_config.js directly for those.
const CONFIG_KEYS = {
    reviveWindowSeconds: 'number',
    reviveHoldTicks: 'number',
    minHearts: 'number',
    maxBonusHeartsFromTokens: 'number',
    heartsPerToken: 'number',
    headDropChance: 'number',
    reviveRangeNoGravestones: 'number',
    reviveRangeGravestones: 'number',
    debug: 'boolean',
    debugChatMessages: 'boolean',
}

// Brigadier suggestion provider for the `option` argument — filters
// CONFIG_KEYS by whatever's already been typed. Shared by both
// `config get` and `config set` below.
function suggestConfigKeys(ctx, builder) {
    const typed = builder.remaining.toLowerCase()
    Object.keys(CONFIG_KEYS).forEach(key => {
        if (key.toLowerCase().startsWith(typed)) builder.suggest(key)
    })
    return builder.buildFuture()
}

ServerEvents.commandRegistry(event => {
    const { commands: Commands, arguments: Arguments } = event

    event.register(
        Commands.literal('downed')
            .requires(src => src.hasPermission(2))

            // ---- /downed revive <player> ----
            .then(
                Commands.literal('revive').then(
                    Commands.argument('target', Arguments.PLAYER.create(event))
                        .executes(ctx => {
                            const player = Arguments.PLAYER.getResult(ctx, 'target')

                            if (!Helpers.isAwaitingRevive(player)) {
                                ctx.source.sendFailure(Text.red(`${player.username} is not currently downed.`))
                                return 0
                            }

                            Helpers.removeBossbar(player)
                            Helpers.endDownedWindow(player)
                            player.setGameMode('survival')
                            player.health = player.maxHealth * 0.5
                            player.potionEffects.add('minecraft:regeneration', 100, 1)
                            // Admin revive: no teleport assumed beyond wherever they
                            // currently are (their death point in spectator), since
                            // that's already a safe location in most cases.

                            ctx.source.sendSuccess(Text.green(`Revived ${player.username}.`), true)
                            player.tell(Text.green('An admin has revived you!'))
                            return 1
                        })
                )
            )

            // ---- /downed add_health <player> <hearts> ----
            .then(
                Commands.literal('add_health').then(
                    Commands.argument('target', Arguments.PLAYER.create(event))
                        .then(
                            Commands.argument('hearts', Arguments.INTEGER.create(event))
                                .executes(ctx => {
                                    const player = Arguments.PLAYER.getResult(ctx, 'target')
                                    const hearts = Arguments.INTEGER.getResult(ctx, 'hearts')

                                    Helpers.adminAddHealth(player, hearts)

                                    const newMax = player.getAttribute('minecraft:generic.max_health').baseValue / 2
                                    ctx.source.sendSuccess(Text.green(`${player.username}'s max hearts adjusted by ${hearts >= 0 ? '+' : ''}${hearts}. Now: ${newMax}.`), true)
                                    player.tell(Text.yellow(`An admin adjusted your max hearts by ${hearts >= 0 ? '+' : ''}${hearts}.`))
                                    return 1
                                })
                        )
                )
            )

            // ---- /downed config get|set ----
            .then(
                Commands.literal('config')
                    .then(
                        Commands.literal('get').then(
                            Commands.argument('option', Arguments.STRING.create(event))
                                .suggests(suggestConfigKeys)
                                .executes(ctx => {
                                    const option = Arguments.STRING.getResult(ctx, 'option')
                                    if (!(option in CONFIG_KEYS)) {
                                        ctx.source.sendFailure(Text.red(`Unknown config option "${option}". Valid: ${Object.keys(CONFIG_KEYS).join(', ')}`))
                                        return 0
                                    }
                                    ctx.source.sendSuccess(Text.aqua(`${option} = ${Config[option]}`), false)
                                    return 1
                                })
                        )
                    )
                    .then(
                        Commands.literal('set').then(
                            Commands.argument('option', Arguments.STRING.create(event))
                                .suggests(suggestConfigKeys)
                                .then(
                                    Commands.argument('value', Arguments.STRING.create(event))
                                        .executes(ctx => {
                                        const option = Arguments.STRING.getResult(ctx, 'option')
                                        const raw = Arguments.STRING.getResult(ctx, 'value')

                                        if (!(option in CONFIG_KEYS)) {
                                            ctx.source.sendFailure(Text.red(`Unknown config option "${option}". Valid: ${Object.keys(CONFIG_KEYS).join(', ')}`))
                                            return 0
                                        }

                                        const type = CONFIG_KEYS[option]
                                        let parsed
                                        if (type === 'boolean') {
                                            if (raw !== 'true' && raw !== 'false') {
                                                ctx.source.sendFailure(Text.red(`${option} expects true/false, got "${raw}".`))
                                                return 0
                                            }
                                            parsed = raw === 'true'
                                        } else {
                                            parsed = parseFloat(raw)
                                            if (Number.isNaN(parsed)) {
                                                ctx.source.sendFailure(Text.red(`${option} expects a number, got "${raw}".`))
                                                return 0
                                            }
                                        }

                                        // This mutates the SAME object every other file
                                        // holds a reference to (Config = global.DownedSystem.Config),
                                        // so changes take effect immediately without a reload —
                                        // no restart needed for most options. Exceptions: values
                                        // baked into already-placed boss bars (e.g. reviveWindowSeconds
                                        // mid-countdown) only apply to the NEXT death, not one in progress.
                                        global.DownedSystem.Config[option] = parsed
                                        ctx.source.sendSuccess(Text.green(`${option} set to ${parsed}.`), true)
                                        return 1
                                    })
                            )
                        )
                    )
            )
    )
})
