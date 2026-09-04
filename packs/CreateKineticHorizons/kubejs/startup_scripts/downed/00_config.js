// ============================================================
// DOWNED SYSTEM — GLOBAL CONFIG
// This file MUST load before any other startup/server script that
// references `global.DownedSystem.Config`. KubeJS loads scripts
// within a folder (including subfolders) in alphabetical order by
// path, hence the "00_" prefix and the shared "downed_system/"
// subfolder for every file in this feature.
//
// Everything this feature exposes globally is namespaced under
// `global.DownedSystem` rather than dumped straight onto `global`,
// so it can't collide with other scripts/addons doing the same
// generic thing.
// ============================================================

global.DownedSystem = {}

global.DownedSystem.Config = {
    // How long (seconds) a player stays in spectator / their grave is
    // revivable before a normal forced respawn happens automatically.
    reviveWindowSeconds: 90,

    // How long (ticks, 20 = 1s) a player must hold right-click with the
    // Revival Token to complete a revive. Keep this in sync with the
    // item's useDuration in 01_items.js — that value is derived from
    // this one, not hand-typed twice.
    reviveHoldTicks: 60,

    // Minimum max hearts a player can be reduced to (1 heart = 2 HP).
    // Death will never take a player below this.
    minHearts: 1,

    // Absolute ceiling on max hearts obtainable via Health Tokens,
    // ON TOP of the base 10 hearts (20 HP). E.g. 10 here allows
    // players to reach a max of 20 hearts total if they never die.
    maxBonusHeartsFromTokens: 10,

    // How many hearts one Health Token grants when consumed.
    heartsPerToken: 1,

    // Chance (0.0–1.0) a player drops their own head on death, killed by another player.
    headDropChance: 0.15,

    // Debuffs applied on a REAL (post-window) respawn.
    respawnDebuffs: {
        blindnessTicks: 60,
        nauseaTicks: 100,
        weaknessTicks: 900, // 45s
        weaknessAmplifier: 0 // Weakness I
    },

    // Distance (blocks) within which a player can be revived via the
    // no-Gravestones fallback (right-click near the death particles).
    reviveRangeNoGravestones: 4,

    // Distance (blocks) within which a right-click on a grave block
    // counts as targeting that grave for revival purposes.
    reviveRangeGravestones: 4,

    // Set to true to log every state transition to console (server log).
    // If debugChatMessages is also true, key transitions are echoed to
    // the affected player's chat as well.
    debug: true,
    debugChatMessages: true,
}
