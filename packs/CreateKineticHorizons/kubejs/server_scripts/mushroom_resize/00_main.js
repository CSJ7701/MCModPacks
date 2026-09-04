// 1. Crafting Recipes
ServerEvents.recipes(event => {
    event.shapeless('kubejs:growth_morsel', ['minecraft:red_mushroom', 'minecraft:redstone'])
    event.shapeless('kubejs:shrink_morsel', ['minecraft:brown_mushroom', 'minecraft:redstone'])
})

// Helper function to adjust target attributes and display status
function applyScaleModifiers(target, scaleDelta, sourcePlayer) {
    let scaleAttr = target.getAttribute('minecraft:generic.scale')
    if (!scaleAttr) return false

    let oldScale = scaleAttr.getBaseValue()
    let newScale = Math.min(Math.max(oldScale + scaleDelta, 0.25), 3.0)
    newScale = Math.round(newScale * 100) / 100

    // 1. Set Scale
    scaleAttr.setBaseValue(newScale)

    // 2. Adjust Jump Height and Safe Fall Distance proportionally
    let jumpAttr = target.getAttribute('minecraft:generic.jump_strength')
    if (jumpAttr) {
	jumpAttr.setBaseValue(0.42 * (newScale / 1.0)) // Default jump is 0.42
    }
    let fallAttr = target.getAttribute('minecraft:generic.safe_fall_distance')
    if (fallAttr) {
	// Safe fall scales linearly with jump height (base 3.0 blocks)
	fallAttr.setBaseValue(3.0 * newScale)
    }

    // 3. Movement Speed
    let speedAttr = target.getAttribute('minecraft:generic.movement_speed')
    if (speedAttr) {
	// Standard base movement speed is ~0.1
	speedAttr.setBaseValue(0.1 * Math.sqrt(newScale))
    }

    // 4. Step Height
    let stepAttr = target.getAttribute('minecraft:generic.step_height')
    if (stepAttr) {
	// Base is 0.6 blocks
	stepAttr.setBaseValue(0.6 * newScale)
    }

    // 5. Adjust Attack Damage proportionally
    let damageAttr = target.getAttribute('minecraft:generic.attack_damage')
    if (damageAttr) {
	let baseDmg = damageAttr.getBaseValue() || 1.0
	damageAttr.setBaseValue(Math.max(1.0, baseDmg * (newScale / oldScale)))
    }

    // Send action bar status message directly to player
    let name = target.isPlayer() ? target.username : target.type.split(':')[1].replace('_', ' ')
    
    // Using tell() formatted for action bar display
    sourcePlayer.tell(Text.of(`${name} Scale: ${newScale}`))
    return true
}

// 2. Right-clicking another entity with morsels
ItemEvents.entityInteracted(event => {
    const { item, target, hand, player } = event
    if (hand !== 'main_hand') return

    let delta = item.id === 'kubejs:growth_morsel' ? 0.25 : item.id === 'kubejs:shrink_morsel' ? -0.25 : 0
    if (delta !== 0) {
	if (applyScaleModifiers(target, delta, player)) {
	    if (!player.isCreative()) item.shrink(1)
	    player.swing()
	    event.cancel()
	}
    }
})

// 3. Eating morsels as player
ItemEvents.foodEaten(event => {
    const { item, player } = event
    let delta = item.id === 'kubejs:growth_morsel' ? 0.25 : item.id === 'kubejs:shrink_morsel' ? -0.25 : 0

    if (delta !== 0) {
	applyScaleModifiers(player, delta, player)
    }
})
