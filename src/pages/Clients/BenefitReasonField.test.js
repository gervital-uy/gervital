import { useState } from 'react'
import { render, screen, fireEvent } from '@testing-library/react'
import BenefitReasonField, { REASON_MAX_LENGTH, reasonOrNull } from './BenefitReasonField'

describe('reasonOrNull', () => {
  test('recorta y deja null lo vacío', () => {
    expect(reasonOrNull('  Convenio  ')).toBe('Convenio')
    expect(reasonOrNull('   ')).toBeNull()
    expect(reasonOrNull('')).toBeNull()
    expect(reasonOrNull(null)).toBeNull()
  })
})

describe('BenefitReasonField', () => {
  function Harness() {
    const [value, setValue] = useState('')
    return <BenefitReasonField value={value} onChange={setValue} />
  }

  test('textarea opcional con label y tope de largo', () => {
    render(<Harness />)
    const box = screen.getByRole('textbox', { name: /Motivo/ })
    expect(box).toHaveAttribute('maxLength', String(REASON_MAX_LENGTH))
    fireEvent.change(box, { target: { value: 'Situación económica' } })
    expect(box).toHaveValue('Situación económica')
  })
})
