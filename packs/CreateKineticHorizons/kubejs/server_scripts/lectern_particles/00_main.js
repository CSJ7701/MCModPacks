// server_scripts/lectern_particle_engine.js

// In-memory cache for active emitters
let LecternEmitters = new Map()

// In-memory set of lectern keys, mirrored to persistent data as JSON
// (avoids manually building NBT ListTag entries, which requires real Tag
// objects rather than plain JS strings)
let SavedLecternKeys = new Set()

function persistLecternKeys(server) {
  server.persistentData.putString('active_lecterns_json', JSON.stringify(Array.from(SavedLecternKeys)))
}

// Vanilla data component types - book pages live here on 1.20.5+, not in NBT.
// entity.book is a raw ItemStack; KubeJS mixes a `.get(DataComponentType)`
// accessor onto ItemStack directly, so we call it with the real component
// type object rather than a string ID.
const DataComponents = Java.loadClass('net.minecraft.core.component.DataComponents')

// Pull the raw page list out of a book ItemStack.
function extractBookPages(book) {
  try {
    // Book & Quill (unsigned) - pages are List<Filterable<String>>
    let writable = book.get(DataComponents.WRITABLE_BOOK_CONTENT)
    if (writable) {
      return writable.pages().map(p => p.raw())
    }

    // Signed written book - pages are List<Filterable<Component>>
    let written = book.get(DataComponents.WRITTEN_BOOK_CONTENT)
    if (written) {
      return written.pages().map(p => p.raw().getString())
    }
  } catch (e) {
    if (!extractBookPages._loggedError) {
      extractBookPages._loggedError = true
      console.log(`[lectern-particles] Component-based page read failed: ${e}`)
    }
  }

  // Legacy fallback: plain NBT list (pre-1.20.5, or a compat mod restoring it)
  if (book.nbt && book.nbt.pages && book.nbt.pages.length) {
    return book.nbt.pages
  }

  if (!extractBookPages._logged) {
    extractBookPages._logged = true
    console.log(`[lectern-particles] Could not find pages via components or nbt. book.id = ${book.id}`)
  }
  return []
}

// Clean JSON text out of book pages
function parseBookConfig(pages) {
  let config = {
    particle: 'minecraft:flame',
    mode: 'point',
    offset: [0, 1, 0],
    area: [1, 1, 1],
    count: 2,
    speed: 0.01,
    freq: 10,
    player: ''
  }

  pages.forEach(pageJson => {
    let rawText = pageJson.toString()
    
    // Extract raw text if wrapped inside JSON formatting
    try {
      let parsed = JSON.parse(rawText)
      if (parsed.text) rawText = parsed.text
    } catch (e) {
      // String was already plain text
      rawText = rawText.replace(/^"|"$/g, '').replace(/\\"/g, '"')
    }

    let lines = rawText.replace(/§./g, '').split('\n')
    lines.forEach(line => {
      let parts = line.split(':')
      if (parts.length < 2) return
      let key = parts[0].trim().toLowerCase()
      let val = parts.slice(1).join(':').trim()

      if (key === 'particle') config.particle = val
      else if (key === 'mode') config.mode = val.toLowerCase()
      else if (key === 'player') config.player = val
      else if (key === 'count') {
        let n = parseInt(val)
        config.count = Math.min(Math.max(isNaN(n) ? 1 : n, 1), 50)
      }
      else if (key === 'speed') {
        let n = parseFloat(val)
        config.speed = isNaN(n) ? 0.01 : n
      }
      else if (key === 'freq') {
        let n = parseInt(val)
        config.freq = Math.max(isNaN(n) ? 10 : n, 2)
      }
      else if (key === 'offset' || key === 'area') {
        let coords = val.split(',').map(n => {
          let f = parseFloat(n.trim())
          return isNaN(f) ? 0 : f
        })
        if (coords.length === 3) config[key] = coords
      }
    })
  })
  return config
}

function updateLecternState(level, blockPos, server) {
  let key = `${level.dimension}/${blockPos.x}/${blockPos.y}/${blockPos.z}`
  let block = level.getBlock(blockPos.x, blockPos.y, blockPos.z)

  if (block.id !== 'minecraft:lectern') {
    LecternEmitters.delete(key)
    return
  }

  let entity = block.entity
  if (!entity || !entity.hasBook()) {
    LecternEmitters.delete(key)
    return
  }

  let book = entity.book
  if (!book || (!book.id.includes('writable_book') && !book.id.includes('written_book'))) return

  let pages = extractBookPages(book)
  console.log(`[lectern-particles] Raw pages: ${JSON.stringify(pages)}`)

  let config = parseBookConfig(pages)
  console.log(`[lectern-particles] Parsed config: ${JSON.stringify(config)}`)

  config.x = blockPos.x + 0.5 + config.offset[0]
  config.y = blockPos.y + 0.5 + config.offset[1]
  config.z = blockPos.z + 0.5 + config.offset[2]
  config.dimension = level.dimension.toString()

  LecternEmitters.set(key, config)

  // Save key location to server persistent data
  if (!SavedLecternKeys.has(key)) {
    SavedLecternKeys.add(key)
    persistLecternKeys(server)
  }
}

// Right-click lectern to register or update configuration
BlockEvents.rightClicked('minecraft:lectern', event => {
  const { block, level, server } = event
  server.scheduleInTicks(2, () => {
    updateLecternState(level, block.pos, server)
  })
})

// Clean up broken lecterns
BlockEvents.broken('minecraft:lectern', event => {
  let key = `${event.level.dimension}/${event.block.x}/${event.block.y}/${event.block.z}`
  LecternEmitters.delete(key)
  if (SavedLecternKeys.delete(key)) {
    persistLecternKeys(event.server)
  }
})

// Restore emitters from persistent server data on level load
LevelEvents.loaded(event => {
  const { level, server } = event
  if (level.isClientSide()) return

  let raw = server.persistentData.getString('active_lecterns_json')
  let keys = []
  try {
    keys = raw ? JSON.parse(raw) : []
  } catch (e) {
    console.log(`[lectern-particles] Failed to parse saved lectern keys: ${e}`)
  }

  keys.forEach(key => {
    SavedLecternKeys.add(key)
    let parts = key.toString().split('/')
    if (parts[0] === level.dimension.toString()) {
      let pos = { x: parseInt(parts[1]), y: parseInt(parts[2]), z: parseInt(parts[3]) }
      if (level.isLoaded(pos.x, pos.y, pos.z)) {
        updateLecternState(level, pos, server)
      }
    }
  })
})

// Main Ticking Engine Loop
ServerEvents.tick(event => {
  const { server } = event

  // Every 5 seconds, check whether any saved lecterns are in chunks that
  // have loaded since we last looked (covers players logging in or
  // wandering into a chunk containing a lectern) and pick them back up.
  // There's no dedicated chunk-load event exposed to scripts, so this
  // periodic sweep is the reliable way to catch it.
  if (server.tickCount % 100 === 0) {
    SavedLecternKeys.forEach(key => {
      if (LecternEmitters.has(key)) return

      let parts = key.split('/')
      let level = server.getLevel(parts[0])
      if (!level) return

      let pos = { x: parseInt(parts[1]), y: parseInt(parts[2]), z: parseInt(parts[3]) }
      if (level.isLoaded(pos.x, pos.y, pos.z)) {
        updateLecternState(level, pos, server)
      }
    })
  }

  LecternEmitters.forEach((config) => {
    if (server.tickCount % config.freq !== 0) return

    let level = server.getLevel(config.dimension)
    if (!level) return

    if (config.mode === 'player') {
      if (!config.player) return
      let targetPlayer = server.getPlayers().find(p => p.username === config.player)
      if (!targetPlayer) return

      let px = targetPlayer.x + config.offset[0] + (Math.random() - 0.5) * config.area[0]
      let py = targetPlayer.y + config.offset[1] + (Math.random() - 0.5) * config.area[1]
      let pz = targetPlayer.z + config.offset[2] + (Math.random() - 0.5) * config.area[2]

      level.spawnParticles(config.particle, true, px, py, pz, 0, 0, 0, config.count, config.speed)
      return
    }

    if (config.mode === 'area') {
      let rx = config.x + (Math.random() - 0.5) * config.area[0]
      let ry = config.y + (Math.random() - 0.5) * config.area[1]
      let rz = config.z + (Math.random() - 0.5) * config.area[2]
      level.spawnParticles(config.particle, true, rx, ry, rz, 0, 0, 0, config.count, config.speed)
      return
    }

    level.spawnParticles(config.particle, true, config.x, config.y, config.z, 0, 0, 0, config.count, config.speed)
  })
})
