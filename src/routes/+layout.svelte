<script>
  import '../style.css'
  import { onMount } from 'svelte'
  let { children } = $props()

  // whether the app under this layout is mounted. always true in production. the
  // lifecycle proof flips it to tear the app down and bring it back in the SAME
  // document, which is the one leak a reload-only suite can never see.
  let alive = $state(true)

  onMount(() => {
    // register the service worker by hand (kit's is disabled) so dev never gets a
    // stale one, and only in the built app
    if (import.meta.env.PROD && 'serviceWorker' in navigator && location.protocol !== 'file:') {
      navigator.serviceWorker.register(`${import.meta.env.BASE_URL}service-worker.js`).catch(() => {})
    }
    // the same-document mount -> unmount -> remount hook tests/lifecycle.spec.ts
    // drives. gated exactly like window.__quarry: present under DEV or MODE=test,
    // absent from a production bundle (tests/sw-update.spec.ts asserts that on a
    // real production build).
    if (import.meta.env.DEV || import.meta.env.MODE === 'test') {
      window.__quarryLifecycle = {
        mount: () => { alive = true },
        unmount: () => { alive = false },
      }
    }
  })
</script>

<svelte:head><title>Quarry</title></svelte:head>

{#if alive}
  {@render children()}
{/if}
