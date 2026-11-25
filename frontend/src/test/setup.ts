import '@testing-library/jest-dom';
import { beforeEach } from 'vitest';
import { libraryStore } from '../services/libraryStore';

beforeEach(() => {
  localStorage.clear();
  libraryStore.resetToSeed(new Date());
});
