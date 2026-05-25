import '@testing-library/jest-dom'
import { vi } from 'vitest'
import React from 'react'

global.ResizeObserver = vi.fn().mockImplementation(() => ({
  observe: vi.fn(),
  unobserve: vi.fn(),
  disconnect: vi.fn(),
}))

vi.mock('next/link', () => {
  return {
    default: ({ href, children, ...props }: { href: string; children?: React.ReactNode; [key: string]: unknown }) =>
      React.createElement('a', { href, ...props }, children),
  }
})
