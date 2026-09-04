StartupEvents.registry('item', event => {
    // Red Growth Morsel
    event.create('growth_morsel')
	.texture('minecraft:block/red_mushroom')
	.food(food => {
	    food
		.nutrition(1)
		.saturation(0.2)
		.alwaysEdible()
		.fastToEat()
	})

    // Brown Shrink Morsel
    event.create('shrink_morsel')
	.texture('minecraft:block/brown_mushroom')
	.food(food => {
	    food
		.nutrition(1)
		.saturation(0.2)
		.alwaysEdible()
		.fastToEat()
	})
})
