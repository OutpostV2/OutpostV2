import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import App from './App'

describe('App', () => {
  it('renders the repository foundation screen', () => {
    render(<App />)

    expect(screen.getByRole('heading', { name: 'Outpost' })).toBeInTheDocument()
    expect(
      screen.getByText('Repository and tooling foundation.'),
    ).toBeInTheDocument()
  })
})
