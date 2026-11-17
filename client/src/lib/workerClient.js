// Small request/response wrapper around a module worker.
// Progress messages are broadcast to every in-flight request.

export function createWorkerClient(WorkerCtor) {
  let worker = null
  let nextId = 0
  const pending = new Map()
  const progressListeners = new Set()

  function ensure() {
    if (worker) return worker
    worker = new WorkerCtor()
    worker.addEventListener('message', (event) => {
      const msg = event.data || {}
      if (msg.type === 'progress') {
        for (const fn of progressListeners) fn(msg)
        return
      }
      const job = pending.get(msg.id)
      if (!job) return
      pending.delete(msg.id)
      if (msg.type === 'error') job.reject(new Error(msg.message || 'Worker request failed'))
      else job.resolve(msg)
    })
    worker.addEventListener('error', (event) => {
      const err = event.error || new Error(event.message || 'Worker error')
      for (const job of pending.values()) job.reject(err)
      pending.clear()
      progressListeners.clear()
    })
    return worker
  }

  function request(type, payload = {}, { transfer = [], onProgress } = {}) {
    const w = ensure()
    const id = ++nextId
    if (onProgress) progressListeners.add(onProgress)
    return new Promise((resolve, reject) => {
      const cleanup = () => {
        if (onProgress) progressListeners.delete(onProgress)
      }
      pending.set(id, {
        resolve: (msg) => {
          cleanup()
          resolve(msg)
        },
        reject: (err) => {
          cleanup()
          reject(err)
        },
      })
      w.postMessage({ id, type, ...payload }, transfer)
    })
  }

  function dispose() {
    const w = worker
    worker = null
    w?.terminate()
    const err = new Error('Worker disposed')
    for (const job of pending.values()) job.reject(err)
    pending.clear()
    progressListeners.clear()
  }

  return { request, dispose }
}
