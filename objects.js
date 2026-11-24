'use strict';

const OBJECTS_KEY = 'fliplab:objects';
const OBJECTS_FORMAT = 'fliplab-objects';
const OBJECTS_VERSION = 1;

class ObjectConflict extends Error {}
class ObjectFileError extends Error {}

function createObjectToken() {
  // getRandomValues is available on local HTTP pages, unlike randomUUID.
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
  return [hex.slice(0, 8), hex.slice(8, 12), hex.slice(12, 16), hex.slice(16, 20), hex.slice(20)].join('-');
}

function isTextMap(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    && Object.values(value).every((field) => typeof field === 'string');
}

function isObjectRecord(record) {
  const draft = record?.draft;
  return typeof record?.id === 'string' && record.id.trim() !== ''
    && typeof record.revision === 'string' && record.revision.trim() !== ''
    && Number.isSafeInteger(record.updatedAt) && record.updatedAt >= 0
    && isTextMap(draft?.base) && isTextMap(draft?.scenario)
    && Array.isArray(draft.works) && draft.works.every((row) => typeof row?.name === 'string' && typeof row.amount === 'string')
    && ['base', 'scenario'].includes(draft.mode);
}

function parseObjects(serialized) {
  let file;
  try {
    file = JSON.parse(serialized);
  } catch {
    throw new ObjectFileError('Invalid JSON');
  }
  if (file?.format !== OBJECTS_FORMAT || file.version !== OBJECTS_VERSION || !Array.isArray(file.objects)
    || !file.objects.every(isObjectRecord) || new Set(file.objects.map(({ id }) => id)).size !== file.objects.length) {
    throw new ObjectFileError('Invalid FlipLab object backup');
  }
  return file.objects;
}

function exportObjects(objects) {
  return JSON.stringify({ format: OBJECTS_FORMAT, version: OBJECTS_VERSION, objects });
}

function readObjects(storage) {
  const serialized = storage.getItem(OBJECTS_KEY);
  return serialized === null ? [] : parseObjects(serialized);
}

function requireCurrentObject(objects, expected) {
  const index = objects.findIndex(({ id }) => id === expected.id);
  if (index === -1 || objects[index].revision !== expected.revision) throw new ObjectConflict();
  return index;
}

function saveObject(storage, draft, expected = null) {
  const objects = readObjects(storage);
  const record = {
    id: expected?.id ?? createObjectToken(),
    revision: createObjectToken(),
    updatedAt: Date.now(),
    draft,
  };
  if (!isObjectRecord(record)) throw new ObjectFileError('Invalid object record');
  if (expected) objects[requireCurrentObject(objects, expected)] = record;
  else objects.unshift(record);
  storage.setItem(OBJECTS_KEY, exportObjects(objects));
  return record;
}

function deleteObject(storage, expected) {
  const objects = readObjects(storage);
  objects.splice(requireCurrentObject(objects, expected), 1);
  storage.setItem(OBJECTS_KEY, exportObjects(objects));
}

function importObjects(storage, serialized) {
  const incoming = parseObjects(serialized);
  const objects = readObjects(storage);
  const ids = new Set(objects.map(({ id }) => id));
  const additions = incoming.filter(({ id }) => !ids.has(id)).map((record) => ({ ...record, revision: createObjectToken() }));
  if (additions.length !== 0) storage.setItem(OBJECTS_KEY, exportObjects([...objects, ...additions]));
  return { added: additions.length, skipped: incoming.length - additions.length };
}

if (typeof module === 'object' && module.exports) {
  module.exports = { readObjects, saveObject, deleteObject, exportObjects, importObjects, ObjectConflict };
}
