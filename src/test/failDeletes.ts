import { vi } from 'vitest';

/**
 * Makes deletes in one IndexedDB object store throw, as a failing write can,
 * after the first `succeed` of them went through. Covers both store.delete()
 * and cursor.delete(). Call it after `fake-indexeddb/auto` is loaded.
 */
export function failDeletesIn(storeName: string, { succeed = 0 } = {}) {
  let left = succeed;
  const shouldFail = (store: IDBObjectStore) => store.name === storeName && left-- <= 0;
  const fail = () => {
    throw new DOMException('Injected delete failure', 'UnknownError');
  };
  const storeDelete = IDBObjectStore.prototype.delete;
  vi.spyOn(IDBObjectStore.prototype, 'delete').mockImplementation(function (
    this: IDBObjectStore,
    query,
  ) {
    return shouldFail(this) ? fail() : storeDelete.call(this, query);
  });
  const cursorDelete = IDBCursor.prototype.delete;
  vi.spyOn(IDBCursor.prototype, 'delete').mockImplementation(function (this: IDBCursor) {
    const store = this.source instanceof IDBIndex ? this.source.objectStore : this.source;
    return shouldFail(store) ? fail() : cursorDelete.call(this);
  });
}
