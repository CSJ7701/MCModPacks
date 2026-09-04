// ============================================================
// RECIPES
// ============================================================

ServerEvents.recipes(event => {
    // --- Revival Token: standard, yields 1 ---
    // Ghast Tear + Redstone + Gold Ingot
    event.shaped(
        'kubejs:revival_token',
        [
            ' G ',
            'RTR',
            ' G '
        ],
        {
            G: 'minecraft:gold_ingot',
            R: 'minecraft:redstone',
            T: 'minecraft:ghast_tear'
        }
    ).id('kubejs:revival_token_standard')

    // --- Revival Token: bulk variant, yields 5 ---
    // Nether Star + Redstone + Gold Ingot — same shape, tear swapped
    // for a nether star as a "buy in bulk" high-cost alternative.
    event.shaped(
        '5x kubejs:revival_token',
        [
            ' G ',
            'RNR',
            ' G '
        ],
        {
            G: 'minecraft:gold_ingot',
            R: 'minecraft:redstone',
            N: 'minecraft:nether_star'
        }
    ).id('kubejs:revival_token_bulk')

    // --- Health Token ---
    // Any Player Head + Nether Quartz + Iron Ingot.
    // Ingredient.of('minecraft:player_head') matches ANY player head
    // regardless of whose skin/NBT is on it — no ownership check,
    // per design decision.
    event.shapeless('kubejs:health_token', [
        'minecraft:player_head',
        'minecraft:quartz',
        'minecraft:iron_ingot'
    ]).id('kubejs:health_token_craft')
})
