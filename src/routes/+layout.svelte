<script>
  import '../style.css'
  import { onMount } from 'svelte'
  let { children } = $props()

  // register the service worker by hand (kit's is disabled) so dev never gets a
  // stale one, and only in the built app
  onMount(() => {
    if (import.meta.env.PROD && 'serviceWorker' in navigator && location.protocol !== 'file:') {
      navigator.serviceWorker.register(`${import.meta.env.BASE_URL}service-worker.js`).catch(() => {})
    }
  })
</script>

<svelte:head><title>Quarry</title></svelte:head>

{@render children()}
