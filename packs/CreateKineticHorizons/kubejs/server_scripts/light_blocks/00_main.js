// server_scripts/survival_light_blocks.js

// Add recipe for Light Blocks
ServerEvents.recipes(event => {
    event.shapeless('minecraft:light', [
	'minecraft:torch',
	'minecraft:glass'
    ])
})

// Allow players to right-click placed Light Blocks in Survival to change levels (0-15)
BlockEvents.rightClicked('minecraft:light', event => {
    const { block, player, hand } = event
    if (hand !== 'main_hand') return

    // Cycle light level 0 -> 15 -> 0
    let currentLevel = block.properties.level ? parseInt(block.properties.level) : 15
    let nextLevel = (currentLevel + 1) % 16

    block.set('minecraft:light', { level: nextLevel.toString() })
    player.setStatusMessage(`Light Level: ${nextLevel}`)
    player.swing()
})

// Left-click in Survival to break Light Block
BlockEvents.leftClicked('minecraft:light', event => {
  const { block, player, level } = event

  // Instantly break block in survival or creative when hit
  level.destroyBlock(block.pos, true, player)
  player.swing()
  event.cancel()
})

// Particle indicator tick for Survival players holding light blocks
PlayerEvents.tick(event => {
    const { player, level, server } = event
    if (server.tickCount % 5 !== 0 || player.isCreative()) return // Run 4x/sec, ignore creative

    let mainHand = player.mainHandItem.id === 'minecraft:light'
    let offHand = player.offHandItem.id === 'minecraft:light'

    if (mainHand || offHand) {
	let px = Math.floor(player.x)
	let py = Math.floor(player.y)
	let pz = Math.floor(player.z)
	let radius = 8

	// Scan nearby blocks for light sources to highlight
	for (let x = -radius; x <= radius; x++) {
	    for (let y = -4; y <= 4; y++) {
		for (let z = -radius; z <= radius; z++) {
		    let bx = px + x, by = py + y, bz = pz + z
		    if (level.getBlock(bx, by, bz).id === 'minecraft:light') {
			level.spawnParticles('minecraft:end_rod', true, bx + 0.5, by + 0.5, bz + 0.5, 0, 0, 0, 1, 0)
		    }
		}
	    }
	}
    }
})

// // 2. Interaction handling (Cycling & Shift-Break)
// BlockEvents.rightClicked('minecraft:light', event => {
//     const { block, player, hand, level } = event
//     if (hand !== 'main_hand') return

//     // Shift + Right-Click with empty hand or light block to break in survival
//     if (player.isShiftKeyDown()) {
// 	level.destroyBlock(block.pos, true, player) // Breaks and drops light block
// 	player.swing()
// 	event.cancel()
// 	return
//     }

//     // Normal Right-Click cycles brightness 0 -> 15
//     let currentLevel = block.properties.level ? parseInt(block.properties.level) : 15
//     let nextLevel = (currentLevel + 1) % 16

//     block.set('minecraft:light', { level: nextLevel.toString() })
//     player.setStatusMessage(`Light Level: ${nextLevel}`)
//     player.swing()
// })
