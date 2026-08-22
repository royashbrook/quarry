<script lang="ts">
  // the shop and stats sheets, ported from main.ts's renderShop/renderStats. those built
  // innerHTML strings; these are real markup, so the rows are keyed, the disabled state
  // is computed rather than string-concatenated, and no user value is ever interpolated
  // into html.
  //
  // ids and classes are unchanged (#sheet-shop, #shop-list, #sheet-stats, #stats-list,
  // .shop-row, .stats-row, #prestige-button) because the e2e suite addresses them.
  import {
    capacity, currentMine, HELPER_PRICES, mineMultiplier, mineReach, MONUMENT_STAGES,
    pickDamage, prestigeMultiplier, upgradeMax, upgradePrice, walkSpeed,
    type GameState, type UpgradeId,
  } from '../engine'
  import type { GameApi } from './api'

  let { which, api, onclose }: { which: 'shop' | 'stats'; api?: GameApi; onclose?: () => void } = $props()

  // a snapshot, refreshed after every action. the engine mutates in place, so re-reading
  // is what keeps the sheet honest; holding a reference would show stale numbers.
  let snap: GameState | null = $state(null)
  const refresh = () => { snap = api?.snapshot() ?? null }

  // the sheet must track the LIVE engine while it is open: helpers keep earning, so a
  // control priced above your coins can become affordable while you are looking at it.
  // refreshing only on action left the pick button disabled for five seconds after the
  // engine had crossed its price.
  $effect(() => {
    which
    prestigeArmed = false // arming is per-visit, never carried across a sheet switch
    refresh()
    const tick = setInterval(refresh, 500)
    return () => clearInterval(tick)
  })

  const SHOP_META: Record<UpgradeId, { name: string; desc: string; icon: string }> = {
    pick: { name: 'PICKAXE', desc: 'more damage per swing', icon: '⛏' },
    pack: { name: 'PACK', desc: 'carry more chunks', icon: '🎒' },
    boots: { name: 'BOOTS', desc: 'walk faster', icon: '👢' },
    swing: { name: 'SWING', desc: 'swing more often', icon: '💪' },
    reach: { name: 'REACH', desc: 'mine from farther away', icon: '🧲' },
    cart: { name: 'CART', desc: 'chute pays more, travels faster', icon: '🛒' },
  }

  const rows = $derived.by(() => {
    if (!snap) return []
    return (Object.keys(SHOP_META) as UpgradeId[]).map(id => {
      const level = snap!.save.upgrades[id]
      const max = upgradeMax(id, snap!.save.mines.length)
      const maxed = level >= max
      const price = maxed ? 0 : upgradePrice(id, level)
      return { id, ...SHOP_META[id], level, max, maxed, price, afford: snap!.save.coins >= price }
    })
  })

  const helper = $derived.by(() => {
    if (!snap) return null
    const mine = currentMine(snap.save)
    const maxed = mine.helpers >= HELPER_PRICES.length
    const price = maxed ? 0 : HELPER_PRICES[mine.helpers] * mineMultiplier(snap.save.mine)
    return { count: mine.helpers, cap: HELPER_PRICES.length, maxed, price, afford: snap.save.coins >= price }
  })

  const stats = $derived.by(() => {
    if (!snap) return null
    const save = snap.save
    return {
      coins: save.coins,
      lifetime: save.lifetime,
      mine: save.mine + 1,
      contracts: save.contractsDone,
      monument: save.monument,
      crew: save.mines.reduce((total, m) => total + m.helpers, 0),
      damage: pickDamage(snap),
      pack: capacity(snap),
      speed: walkSpeed(snap),
      reach: mineReach(snap),
      canPrestige: save.monument >= MONUMENT_STAGES.length,
      nextMultiplier: prestigeMultiplier(save) + 0.5,
    }
  })


  let prestigeArmed = $state(false)

  // same contract as the settings sheet: focus lands IN the thing that just opened,
  // rather than staying behind it. it was wired to settings only.
  function focusOnOpen(node: HTMLElement) { node.focus() }

  function buy(id: UpgradeId): void {
    api?.buy(id)
    refresh()
  }
  function hire(): void {
    api?.hire()
    refresh()
  }
  function prestige(): void {
    if (!prestigeArmed) { prestigeArmed = true; return }
    const ok = api?.prestige() ?? false
    prestigeArmed = false
    refresh()
    if (ok) onclose?.() // the old sheet closed on a successful prestige
  }
</script>

<style>
  /* the house tap-target floor. these actions measured 39.594px at 320x568, which is
     under it: a phone control that a thumb misses is a broken control. */
  #shop-list button, #prestige-button { min-height: 44px; }
</style>

{#if which === 'shop'}
  <div id="sheet-shop" class="sheet" role="dialog" aria-label="Shop" tabindex="-1" use:focusOnOpen>
    <h2>SHOP</h2>
    <div id="shop-list">
      {#each rows as row (row.id)}
        <div class="shop-row">
          <span>{row.icon}</span>
          <span class="grow">
            <span class="name">{row.name} LV{row.level}/{row.max}</span><br>
            <span class="desc">{row.desc}</span>
          </span>
          <button data-buy={row.id} disabled={row.maxed || !row.afford} onclick={() => buy(row.id)}>
            {row.maxed ? 'MAX' : row.price}
          </button>
        </div>
      {/each}
      {#if helper}
        <div class="shop-row">
          <span>👷</span>
          <span class="grow">
            <span class="name">HELPER ×{helper.count}/{helper.cap}</span><br>
            <span class="desc">mines and sells on their own, stays in this mine</span>
          </span>
          <button data-hire="1" disabled={helper.maxed || !helper.afford} onclick={hire}>
            {helper.maxed ? 'MAX' : helper.price}
          </button>
        </div>
      {/if}
    </div>
  </div>
{/if}

{#if which === 'stats' && stats}
  <div id="sheet-stats" class="sheet" role="dialog" aria-label="Stats" tabindex="-1" use:focusOnOpen>
    <h2>STATS</h2>
    <div id="stats-list">
      {#if stats.canPrestige}
        <button id="prestige-button" class="big-button prestige" data-armed={prestigeArmed ? '' : undefined} onclick={prestige}>
          {prestigeArmed ? '!? EVERYTHING RESETS, TAP AGAIN' : `⭐ NEW QUARRY ×${stats.nextMultiplier}`}
        </button>
      {/if}
      <dl class="stats-row">
        <dt>coins</dt><dd>{stats.coins}</dd>
        <dt>lifetime earned</dt><dd>{stats.lifetime}</dd>
        <dt>mine</dt><dd>{stats.mine}</dd>
        <dt>contracts done</dt><dd>{stats.contracts}</dd>
        <dt>monument</dt><dd>{stats.monument}/5</dd>
        <dt>crew across mines</dt><dd>{stats.crew}</dd>
        <dt>pick damage</dt><dd>{stats.damage}</dd>
        <dt>pack size</dt><dd>{stats.pack}</dd>
        <dt>walk speed</dt><dd>{stats.speed}</dd>
        <dt>mining reach</dt><dd>{stats.reach}</dd>
      </dl>
    </div>
  </div>
{/if}
