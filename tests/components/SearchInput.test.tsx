import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, beforeEach, vi } from 'vitest'
import SearchInput from '@/components/layout/SearchInput'
import { SearchProvider } from '@/lib/search-context'

const mocks = vi.hoisted(() => ({ push: vi.fn(), pathname: '/' }))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mocks.push }),
  usePathname: () => mocks.pathname,
}))

function renderInput() {
  return render(
    <SearchProvider>
      <SearchInput />
    </SearchProvider>
  )
}

describe('SearchInput', () => {
  beforeEach(() => {
    mocks.push.mockClear()
    mocks.pathname = '/'
  })

  it('updates the input value as the user types', () => {
    renderInput()
    const input = screen.getByPlaceholderText(/search/i) as HTMLInputElement
    fireEvent.change(input, { target: { value: 'rain' } })
    expect(input.value).toBe('rain')
  })

  it('does not navigate while searching from the home page', () => {
    mocks.pathname = '/'
    renderInput()
    fireEvent.change(screen.getByPlaceholderText(/search/i), { target: { value: 'rain' } })
    expect(mocks.push).not.toHaveBeenCalled()
  })

  it('navigates to the home browse page when searching from another page', () => {
    mocks.pathname = '/dashboard'
    renderInput()
    fireEvent.change(screen.getByPlaceholderText(/search/i), { target: { value: 'rain' } })
    expect(mocks.push).toHaveBeenCalledWith('/')
  })
})
