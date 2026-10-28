import { vi } from 'vitest';

/**
 * Makes deletes in one IndexedDB object store fail, as a failing write can,
 * after the first `succeed` of them went through. Covers both store.delete()
 * and cursor.delete(). Needs `fake-indexeddb/auto`, which src/test/setup.ts loads.
 *
 * By default the delete throws synchronously. With `async: true` it instead
 * returns a real request that fails later with a ConstraintError, which
 * aborts the transaction as an unhandled request error does. The store's
 * keyPath must be a single string.
 */
export function failDeletesIn(storeName: string, { succeed = 0, async = false } = {}) {
  let left = succeed;
  const shouldFail = (store: IDBObjectStore) => store.name === storeName && left-- <= 0;
  const fail = (store: IDBObjectStore, key: IDBValidKey | IDBKeyRange): IDBRequest<undefined> => {
    if (!async) throw new DOMException('Injected delete failure', 'UnknownError');
    // Adding a record under a key that already exists fails asynchronously.
    const request = store.add({ [store.keyPath as string]: key });
    return request as IDBRequest<unknown> as IDBRequest<undefined>;
  };
  const storeDelete = IDBObjectStore.prototype.delete;
  vi.spyOn(IDBObjectStore.prototype, 'delete').mockImplementation(function (
    this: IDBObjectStore,
    query,
  ) {
    return shouldFail(this) ? fail(this, query) : storeDelete.call(this, query);
  });
  const cursorDelete = IDBCursor.prototype.delete;
  vi.spyOn(IDBCursor.prototype, 'delete').mockImplementation(function (this: IDBCursor) {
    const store = this.source instanceof IDBIndex ? this.source.objectStore : this.source;
    return shouldFail(store) ? fail(store, this.primaryKey) : cursorDelete.call(this);
  });
}
