// ============================================================
// CUSTOM ITEMS
// Revival Token — used to revive a downed player (hold right-click).
// Health Token  — consumed to permanently raise max hearts.
// Both reuse vanilla item textures via .texture(), which generates
// the item model for you — no hand-written model JSON needed.
// ============================================================

StartupEvents.registry('item', event => {
    event.create('revival_token')
        .displayName('Revival Token')
        .texture('minecraft:item/ghast_tear')
        .maxStackSize(16)
        .rarity('uncommon')
        .useAnimation('spear') // reads as "channeling" rather than "eating"
        .useDuration(itemstack => global.DownedSystem.Config.reviveHoldTicks)
	.finishUsing((itemstack, level, entity) => {
	    // global.DownedSystem.Helpers is populated in server_scripts
	    // Fully loaded by the time a player finishes using this in game
	    if (global.DownedSystem.Helpers && global.DownedSystem.Helpers.completeRevive) {
		return global.DownedSystem.Helpers.completeRevive(itemstack, level, entity)
	    }
	    console.log('[Downed] ERROR: global.DownedSystem.Helpers.completeRevive missing - did server_scrips fail to load?')
	    return itemstack
	})
        .glow(true)
        .tooltip('Hold right-click on a fallen player (or their grave) to revive them.')

    event.create('health_token')
        .displayName('Health Token')
        .texture('minecraft:item/nether_star')
        .maxStackSize(16)
        .rarity('rare')
        .glow(true)
        .tooltip(`Permanently grants +${global.DownedSystem.Config.heartsPerToken} max heart, up to the configured limit.`)
})
