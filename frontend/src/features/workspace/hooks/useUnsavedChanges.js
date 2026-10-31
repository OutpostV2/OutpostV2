import { useEffect } from 'react'
import { useBlocker } from 'react-router'
export default function useUnsavedChanges(dirty) {
  useBlocker(
    ({ currentLocation, nextLocation }) =>
      dirty &&
      (currentLocation.pathname !== nextLocation.pathname ||
        currentLocation.search !== nextLocation.search) &&
      !window.confirm('You have unsaved changes. Leave this page?'),
  )
  useEffect(() => {
    if (!dirty) return
    const unload = (e) => {
      e.preventDefault()
      e.returnValue = ''
    }
    window.addEventListener('beforeunload', unload)
    return () => {
      window.removeEventListener('beforeunload', unload)
    }
  }, [dirty])
}
