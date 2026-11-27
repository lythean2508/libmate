import '@testing-library/jest-dom';
import { beforeEach } from 'vitest';
import { libraryStore } from '../services/libraryStore';

beforeEach(() => {
  if (typeof localStorage === 'undefined') return;
  localStorage.clear();
  libraryStore.resetToSeed(new Date());
});
