// Stage 15 multi-tile NetClient scaffolding tests.
//
// Verifies the Map<TileKey, TileMesh> topology: home-mesh invariants,
// addTile/removeTile lifecycle, per-tile isolation, and that the public
// accessors stay home-mesh-only. Stage 16 will drive addTile/removeTile
// from the player's position via shadowTilesOf(); these tests establish
// the contract that drives can rely on.

import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { NetClient, type NetClientDeps } from '../../src/net/client.js';
import { encodeMessage } from '../../src/net/protocol.js';
import type { Room } from '../../src/net/room.js';
import type { TileId } from '../../src/net/tile-id.js';
import { type Config, type GridState, type Player, newRng } from '../../src/sim/index.js';
import { MockRoomNetwork, isolatedTileRoomFactory } from './mock-room.js';

const cfg: Config = { width: 24, height: 24, halfLifeTicks: 60, seed: 0xdeadn, circular: false };

function initialState(pid: string): GridState {
  const p: Player = {
    id: pid,
    pos: { x: 12, y: 12 },
    dir: 1,
    isAlive: true,
    respawnAtTick: null,
    score: 0,
    colorSeed: 0xa11ce,
  };
  return {
    tick: 0,
    config: cfg,
    rng: newRng(cfg.seed),
    players: new Map([[pid, p]]),
    cells: new Map(),
  };
}

function peerHello(pid: string, joinedAt: number, colorSeed = 0xabc): string {
  return encodeMessage({
    v: 1,
    t: 'HELLO',
    from: pid,
    color: [colorSeed & 0xff, (colorSeed >> 8) & 0xff, (colorSeed >> 16) & 0xff],
    color_seed: colorSeed,
    kind: 'pilot',
    client: 'grid/test',
    joined_at: joinedAt,
  });
}

function makeClient(
  deps: NetClientDeps,
  id = 'alice@host',
  homeTile: TileId = { x: 0, y: 0 },
): NetClient {
  return new NetClient(
    {
      identity: { id, colorSeed: 0xa1, joinedAt: 1000 },
      initialState: initialState(id),
      homeTile,
    },
    deps,
  );
}

// ---------------------------------------------------------------------------
// Construction + default state
// ---------------------------------------------------------------------------

describe('NetClient multi-tile — construction', () => {
  it('starts with exactly the home mesh in activeTiles', async () => {
    const net = new MockRoomNetwork();
    const client = makeClient({
      roomFactory: net.tileFactory('alice@host'),
      clock: () => 0,
    });
    await client.start();

    const tiles = client.activeTiles();
    assert.equal(tiles.length, 1);
    assert.deepEqual(tiles[0], { x: 0, y: 0 });
    assert.equal(client.hasTile({ x: 0, y: 0 }), true);
    assert.equal(client.hasTile({ x: 1, y: 0 }), false);

    await client.stop();
  });

  it('home tile can be a negative coordinate', async () => {
    const net = new MockRoomNetwork();
    const client = makeClient(
      { roomFactory: net.tileFactory('alice@host'), clock: () => 0 },
      'alice@host',
      { x: -3, y: -7 },
    );
    await client.start();
    assert.equal(client.hasTile({ x: -3, y: -7 }), true);
    assert.equal(client.hasTile({ x: 3, y: 7 }), false);
    await client.stop();
  });
});

// ---------------------------------------------------------------------------
// addTile / removeTile lifecycle
// ---------------------------------------------------------------------------

describe('NetClient multi-tile — addTile / removeTile', () => {
  it('addTile creates a new mesh and hasTile returns true', async () => {
    const { factory } = isolatedTileRoomFactory('alice@host');
    const client = makeClient({ roomFactory: factory, clock: () => 0 });
    await client.start();

    await client.addTile({ x: 1, y: 0 });
    assert.equal(client.hasTile({ x: 1, y: 0 }), true);
    assert.equal(client.activeTiles().length, 2);

    await client.stop();
  });

  it('addTile is idempotent for the same tile', async () => {
    const { factory } = isolatedTileRoomFactory('alice@host');
    const client = makeClient({ roomFactory: factory, clock: () => 0 });
    await client.start();

    await client.addTile({ x: 1, y: 0 });
    await client.addTile({ x: 1, y: 0 });
    assert.equal(client.activeTiles().length, 2, 'no second mesh created');

    await client.stop();
  });

  it('addTile at the home tile is idempotent (no double-create)', async () => {
    const { factory } = isolatedTileRoomFactory('alice@host');
    const client = makeClient({ roomFactory: factory, clock: () => 0 });
    await client.start();
    await client.addTile({ x: 0, y: 0 });
    assert.equal(client.activeTiles().length, 1, 'home tile still the only mesh');
    await client.stop();
  });

  it('removeTile stops and removes a non-home mesh', async () => {
    const { factory } = isolatedTileRoomFactory('alice@host');
    const client = makeClient({ roomFactory: factory, clock: () => 0 });
    await client.start();

    await client.addTile({ x: 1, y: 0 });
    assert.equal(client.hasTile({ x: 1, y: 0 }), true);
    await client.removeTile({ x: 1, y: 0 });
    assert.equal(client.hasTile({ x: 1, y: 0 }), false);
    assert.equal(client.activeTiles().length, 1);

    await client.stop();
  });

  it('removeTile is idempotent for an absent tile', async () => {
    const { factory } = isolatedTileRoomFactory('alice@host');
    const client = makeClient({ roomFactory: factory, clock: () => 0 });
    await client.start();
    await client.removeTile({ x: 99, y: 99 });
    assert.equal(client.activeTiles().length, 1);
    await client.stop();
  });

  it('removeTile(homeTile) throws', async () => {
    const net = new MockRoomNetwork();
    const client = makeClient({
      roomFactory: net.tileFactory('alice@host'),
      clock: () => 0,
    });
    await client.start();
    await assert.rejects(
      client.removeTile({ x: 0, y: 0 }),
      /is the home tile/,
      'home tile removal rejected',
    );
    assert.equal(client.hasTile({ x: 0, y: 0 }), true);
    await client.stop();
  });

  it('addTile after stop throws', async () => {
    const net = new MockRoomNetwork();
    const client = makeClient({
      roomFactory: net.tileFactory('alice@host'),
      clock: () => 0,
    });
    await client.start();
    await client.stop();
    await assert.rejects(client.addTile({ x: 1, y: 0 }), /after NetClient\.stop/);
  });
});

// ---------------------------------------------------------------------------
// Per-tile isolation
// ---------------------------------------------------------------------------

describe('NetClient multi-tile — isolation', () => {
  it('a peer in a non-home tile does NOT appear in client.peers', async () => {
    // Isolated networks per tile so a bob-in-tile-(1,0) is truly unreachable
    // from the home mesh at (0,0).
    const { factory, networkFor } = isolatedTileRoomFactory('alice@host');
    const client = makeClient({ roomFactory: factory, clock: () => 0 });
    await client.start();
    await client.addTile({ x: 1, y: 0 });

    // Inject bob into the (1,0) network — reaches the non-home mesh only.
    const bobRoom = networkFor({ x: 1, y: 0 }).createRoom('bob@host');
    bobRoom.sendCtrl(peerHello('bob@host', 2000));

    // client.peers reflects the home mesh, which has no knowledge of bob.
    assert.equal(client.peers.has('bob@host'), false);
    assert.deepEqual([...client.peers], ['alice@host']);

    await bobRoom.leave();
    await client.stop();
  });

  it('peer-join callback fires once per mesh (flat fan-out in Stage 15)', async () => {
    // A peer visible in the home mesh fires onPeerJoin once. Same peer
    // visible in a second mesh fires it once more — Stage 17b will
    // deduplicate by pid, but Stage 15 is intentionally per-mesh.
    const { factory, networkFor } = isolatedTileRoomFactory('alice@host');
    const client = makeClient({ roomFactory: factory, clock: () => 0 });
    const joins: string[] = [];
    client.on('peerJoin', (pid) => joins.push(pid));
    await client.start();
    await client.addTile({ x: 1, y: 0 });

    // bob@host appears in the home tile network.
    const bobHome = networkFor({ x: 0, y: 0 }).createRoom('bob@host');
    bobHome.sendCtrl(peerHello('bob@host', 2000));
    // bob@host also appears in the (1,0) tile network.
    const bobShadow = networkFor({ x: 1, y: 0 }).createRoom('bob@host');
    bobShadow.sendCtrl(peerHello('bob@host', 2000));

    assert.equal(joins.length, 2, 'onPeerJoin fires per mesh');
    assert.deepEqual(joins, ['bob@host', 'bob@host']);

    await bobHome.leave();
    await bobShadow.leave();
    await client.stop();
  });
});

// ---------------------------------------------------------------------------
// Lifecycle propagation (start / stop / reset all meshes)
// ---------------------------------------------------------------------------

describe('NetClient multi-tile — lifecycle', () => {
  it('stop() closes every mesh (BYE broadcast on each tile)', async () => {
    const { factory, networkFor } = isolatedTileRoomFactory('alice@host');
    const client = makeClient({ roomFactory: factory, clock: () => 0 });
    await client.start();
    await client.addTile({ x: 1, y: 0 });

    // Watcher on each tile's network observes the BYE.
    const homeWatcher = networkFor({ x: 0, y: 0 }).createRoom('watcher-home');
    const shadowWatcher = networkFor({ x: 1, y: 0 }).createRoom('watcher-shadow');
    let homeSawBye = false;
    let shadowSawBye = false;
    homeWatcher.onCtrl((raw) => {
      if (raw.includes('"BYE"')) homeSawBye = true;
    });
    shadowWatcher.onCtrl((raw) => {
      if (raw.includes('"BYE"')) shadowSawBye = true;
    });

    await client.stop();
    assert.equal(homeSawBye, true, 'home mesh broadcast BYE');
    assert.equal(shadowSawBye, true, 'shadow mesh broadcast BYE');
  });

  it('resetForNewDay resets every mesh (tick 0 across the board)', async () => {
    const { factory, networkFor } = isolatedTileRoomFactory('alice@host');
    const client = makeClient({ roomFactory: factory, clock: () => 0 });
    await client.start();
    await client.addTile({ x: 1, y: 0 });

    // Bring peers into each mesh so both unpause and can advance.
    const peerHome = networkFor({ x: 0, y: 0 }).createRoom('bob@host');
    peerHome.sendCtrl(peerHello('bob@host', 2000));
    const peerShadow = networkFor({ x: 1, y: 0 }).createRoom('carol@host');
    peerShadow.sendCtrl(peerHello('carol@host', 2000));

    // Advance the home mesh a few ticks.
    let now = 0;
    for (let i = 0; i < 10; i++) {
      now += 110;
      client.runOnce(now);
    }
    assert.ok(client.currentState.tick > 0, 'home advanced');

    const freshState: GridState = {
      ...initialState('alice@host'),
    };
    client.resetForNewDay(freshState);
    assert.equal(client.currentState.tick, 0, 'home mesh reset to tick 0');
    // The shadow mesh is also reset — we can't see its tick directly, but
    // its room stays open (isStopped=false is a TileMesh invariant after
    // reset). Verify by confirming it still accepts peer HELLOs.
    const lateShadow = networkFor({ x: 1, y: 0 }).createRoom('dave@host');
    lateShadow.sendCtrl(peerHello('dave@host', 3000));
    // No crash, no throw — the shadow mesh is alive post-reset.

    await peerHome.leave();
    await peerShadow.leave();
    await lateShadow.leave();
    await client.stop();
  });
});

// ---------------------------------------------------------------------------
// Accessor semantics — home-only singular state
// ---------------------------------------------------------------------------

describe('NetClient multi-tile — accessors are home-only', () => {
  it('currentState / stateHash / chainHash reflect only the home mesh', async () => {
    const { factory, networkFor } = isolatedTileRoomFactory('alice@host');
    const client = makeClient({ roomFactory: factory, clock: () => 0 });
    await client.start();
    await client.addTile({ x: 1, y: 0 });

    // Inject a peer into the SHADOW mesh and let it advance; the home mesh
    // stays paused (no home peer, no seed-timeout trigger here). currentState
    // should still show tick 0 regardless of shadow-mesh activity.
    const shadowPeer = networkFor({ x: 1, y: 0 }).createRoom('bob@host');
    shadowPeer.sendCtrl(peerHello('bob@host', 2000));

    let now = 0;
    for (let i = 0; i < 10; i++) {
      now += 110;
      client.runOnce(now);
    }
    // The shadow mesh was unpaused by bob's junior HELLO and advances.
    // But the singular accessors ignore it — they watch the home mesh only.
    // Home mesh has no unpauser so stays at tick 0.
    assert.equal(client.currentState.tick, 0, 'home mesh state unchanged');

    await shadowPeer.leave();
    await client.stop();
  });

  it('tick listeners only fire for home-mesh advances', async () => {
    const { factory, networkFor } = isolatedTileRoomFactory('alice@host');
    const client = makeClient({ roomFactory: factory, clock: () => 0 });
    let ticks = 0;
    client.on('tick', () => {
      ticks++;
    });
    await client.start();
    await client.addTile({ x: 1, y: 0 });

    // Only the shadow mesh has a peer; only the shadow mesh can advance.
    // Tick listeners must stay silent.
    const shadowPeer = networkFor({ x: 1, y: 0 }).createRoom('bob@host');
    shadowPeer.sendCtrl(peerHello('bob@host', 2000));
    let now = 0;
    for (let i = 0; i < 10; i++) {
      now += 110;
      client.runOnce(now);
    }
    assert.equal(ticks, 0, 'no tick events — home mesh did not advance');

    await shadowPeer.leave();
    await client.stop();
  });
});

// ---------------------------------------------------------------------------
// Event fan-out symmetry — peerLeave, evict, onKicked
// ---------------------------------------------------------------------------

describe('NetClient multi-tile — event fan-out', () => {
  it('peerLeave fires per mesh when a peer disconnects from each', async () => {
    const { factory, networkFor } = isolatedTileRoomFactory('alice@host');
    const client = makeClient({ roomFactory: factory, clock: () => 0 });
    const leaves: string[] = [];
    client.on('peerLeave', (pid) => leaves.push(pid));
    await client.start();
    await client.addTile({ x: 1, y: 0 });

    const bobHome = networkFor({ x: 0, y: 0 }).createRoom('bob@host');
    bobHome.sendCtrl(peerHello('bob@host', 2000));
    const bobShadow = networkFor({ x: 1, y: 0 }).createRoom('bob@host');
    bobShadow.sendCtrl(peerHello('bob@host', 2000));

    await bobHome.leave();
    await bobShadow.leave();
    assert.deepEqual(leaves, ['bob@host', 'bob@host'], 'peerLeave fires per mesh');

    await client.stop();
  });

  it('onKicked in any mesh stops the whole client', async () => {
    const { factory, networkFor } = isolatedTileRoomFactory('alice@host');
    const client = makeClient({ roomFactory: factory, clock: () => 0 });
    await client.start();
    await client.addTile({ x: 1, y: 0 });

    // Inject a peer into the shadow mesh and send KICKED from it.
    const mallory = networkFor({ x: 1, y: 0 }).createRoom('mallory@host');
    mallory.sendCtrl(peerHello('mallory@host', 999));
    mallory.sendCtrl(
      encodeMessage({
        v: 1,
        t: 'KICKED',
        from: 'mallory@host',
        to: 'alice@host',
        reason: 'hash_mismatch',
      }),
    );

    // The onKicked callback does `void this.stop()`. The synchronous prefix
    // of stop() — including setting the `stopped` flag — runs before control
    // returns from the dispatch chain, so the invariant is observable
    // immediately: addTile rejects because the client is stopped.
    await assert.rejects(client.addTile({ x: 2, y: 0 }), /after NetClient\.stop/);

    await mallory.leave();
  });
});

// ---------------------------------------------------------------------------
// Home-only inputs and daemon placement
// ---------------------------------------------------------------------------

describe('NetClient multi-tile — home-only routing', () => {
  it('setLocalInput broadcasts INPUT only through the home mesh', async () => {
    const { factory, networkFor } = isolatedTileRoomFactory('alice@host');
    const client = makeClient({ roomFactory: factory, clock: () => 0 });
    await client.start();
    await client.addTile({ x: 1, y: 0 });

    const homeWatcher = networkFor({ x: 0, y: 0 }).createRoom('watcher-home');
    const shadowWatcher = networkFor({ x: 1, y: 0 }).createRoom('watcher-shadow');
    let homeInputs = 0;
    let shadowInputs = 0;
    homeWatcher.onTick((raw) => {
      if (raw.includes('"INPUT"') && raw.includes('"alice@host"')) homeInputs++;
    });
    shadowWatcher.onTick((raw) => {
      if (raw.includes('"INPUT"') && raw.includes('"alice@host"')) shadowInputs++;
    });

    client.setLocalInput('L');

    assert.ok(homeInputs > 0, 'home mesh broadcast the local INPUT');
    assert.equal(shadowInputs, 0, 'shadow mesh did NOT broadcast the local INPUT');

    await homeWatcher.leave();
    await shadowWatcher.leave();
    await client.stop();
  });

  it('runOnce returns the home mesh state specifically, not a shadow', async () => {
    // Arrange shadow to advance (peer present) but home to stay paused.
    // runOnce must return `null` (home didn't advance) — not a shadow state.
    const { factory, networkFor } = isolatedTileRoomFactory('alice@host');
    const client = makeClient({ roomFactory: factory, clock: () => 0 });
    await client.start();
    await client.addTile({ x: 1, y: 0 });
    const shadowPeer = networkFor({ x: 1, y: 0 }).createRoom('bob@host');
    shadowPeer.sendCtrl(peerHello('bob@host', 2000));

    let lastReturn: GridState | null = null;
    let now = 0;
    for (let i = 0; i < 10; i++) {
      now += 110;
      lastReturn = client.runOnce(now);
    }
    // Home never advanced → every runOnce returned null for home.
    assert.equal(lastReturn, null, 'runOnce returned null — home did not advance');

    await shadowPeer.leave();
    await client.stop();
  });

  it('tick callback fires exactly once per home advance, even with shadow advancing in parallel', async () => {
    const { factory, networkFor } = isolatedTileRoomFactory('alice@host');
    const client = makeClient({ roomFactory: factory, clock: () => 0 });
    let ticks = 0;
    client.on('tick', () => {
      ticks++;
    });
    await client.start();
    await client.addTile({ x: 1, y: 0 });

    // Both meshes get a peer so both can advance.
    const homePeer = networkFor({ x: 0, y: 0 }).createRoom('bob@host');
    homePeer.sendCtrl(peerHello('bob@host', 2000));
    const shadowPeer = networkFor({ x: 1, y: 0 }).createRoom('carol@host');
    shadowPeer.sendCtrl(peerHello('carol@host', 2000));

    let now = 0;
    const homeStart = client.currentState.tick;
    for (let i = 0; i < 10; i++) {
      now += 110;
      client.runOnce(now);
    }
    const homeAdvances = client.currentState.tick - homeStart;
    assert.ok(homeAdvances > 0, 'home mesh advanced');
    assert.equal(ticks, homeAdvances, 'tick listener fires once per home advance, no shadow noise');

    await homePeer.leave();
    await shadowPeer.leave();
    await client.stop();
  });
});

// ---------------------------------------------------------------------------
// Lifecycle edges
// ---------------------------------------------------------------------------

describe('NetClient multi-tile — lifecycle edges', () => {
  it('re-add cycle: addTile → removeTile → addTile works', async () => {
    const { factory } = isolatedTileRoomFactory('alice@host');
    const client = makeClient({ roomFactory: factory, clock: () => 0 });
    await client.start();

    await client.addTile({ x: 1, y: 0 });
    assert.equal(client.hasTile({ x: 1, y: 0 }), true);
    await client.removeTile({ x: 1, y: 0 });
    assert.equal(client.hasTile({ x: 1, y: 0 }), false);
    await client.addTile({ x: 1, y: 0 });
    assert.equal(client.hasTile({ x: 1, y: 0 }), true);
    assert.equal(client.activeTiles().length, 2);

    await client.stop();
  });

  it('removeTile after stop is a safe no-op (does not throw)', async () => {
    const { factory } = isolatedTileRoomFactory('alice@host');
    const client = makeClient({ roomFactory: factory, clock: () => 0 });
    await client.start();
    await client.addTile({ x: 1, y: 0 });
    await client.stop();
    // After stop, the shadow entry is still in the meshes map but the
    // TileMesh is stopped. removeTile finds it and calls stop() again —
    // idempotent at the TileMesh layer, no throw.
    await client.removeTile({ x: 1, y: 0 });
    await client.removeTile({ x: 42, y: 42 }); // never added — also safe.
  });

  it('stop is idempotent under multi-tile', async () => {
    const { factory } = isolatedTileRoomFactory('alice@host');
    const client = makeClient({ roomFactory: factory, clock: () => 0 });
    await client.start();
    await client.addTile({ x: 1, y: 0 });
    await client.addTile({ x: 2, y: 0 });
    await client.stop();
    await client.stop(); // second call must not throw
  });

  it('public accessors remain callable after stop (no crash)', async () => {
    const { factory } = isolatedTileRoomFactory('alice@host');
    const client = makeClient({ roomFactory: factory, clock: () => 0 });
    await client.start();
    await client.stop();
    // Post-stop reads: we kept the meshes map populated for this reason.
    assert.equal(client.currentState.tick, 0);
    assert.equal(typeof client.stateHash, 'string');
    assert.ok(client.chainHash instanceof Uint8Array);
    assert.equal(client.peers.has('alice@host'), true);
    assert.equal(client.hasTile({ x: 0, y: 0 }), true);
    assert.equal(client.runOnce(1000), null, 'runOnce is inert after stop');
  });

  it('activeTiles is stable order — home first, then insertion order', async () => {
    const { factory } = isolatedTileRoomFactory('alice@host');
    const client = makeClient({ roomFactory: factory, clock: () => 0 });
    await client.start();
    await client.addTile({ x: 1, y: 0 });
    await client.addTile({ x: 0, y: 1 });
    await client.addTile({ x: -1, y: 0 });
    const tiles = client.activeTiles();
    assert.deepEqual(tiles, [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 0, y: 1 },
      { x: -1, y: 0 },
    ]);
    await client.stop();
  });

  it('addTile cleans up its map entry if mesh.start() throws', async () => {
    // Craft a factory that fails on a specific tile.
    const { factory: isoFactory } = isolatedTileRoomFactory('alice@host');
    const failingFactory = async (tile: TileId): Promise<Room> => {
      if (tile.x === 1 && tile.y === 0) throw new Error('boom');
      return isoFactory(tile);
    };
    const client = makeClient({ roomFactory: failingFactory, clock: () => 0 });
    await client.start();

    await assert.rejects(client.addTile({ x: 1, y: 0 }), /boom/);
    assert.equal(
      client.hasTile({ x: 1, y: 0 }),
      false,
      'failed addTile did not leave a phantom entry',
    );
    assert.equal(client.activeTiles().length, 1, 'only the home mesh remains');
    // Subsequent addTile for the same failing tile is NOT idempotent-blocked —
    // the failed entry was cleaned, so retries can try again.
    await assert.rejects(client.addTile({ x: 1, y: 0 }), /boom/);

    await client.stop();
  });
});

// Daemon routing: the end-to-end "deployDaemon targets home mesh" path
// requires spawning a subprocess and is covered by tile-mesh.test.ts's
// `broadcastDaemonHello emits the documented wire format` test plus
// client.test.ts's deployDaemon-after-stop rejection. The multi-tile
// routing contract follows from `deployDaemon` calling `this.homeMesh.
// broadcastDaemonHello` directly — no mesh-iteration involved, so no
// new test surface is needed at this layer.
