import { useEffect, useId, useMemo, useRef, useState } from 'react'
import './SearchableSelect.css'

const EMPTY_OPTIONS = []

const normalizeSearchText = (value) => String(value ?? '')
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/gu, '')
  .replace(/đ/gu, 'd')
  .replace(/Đ/gu, 'D')
  .trim()
  .toLocaleLowerCase('vi-VN')

const valuesMatch = (left, right) => (
  Object.is(left, right)
  || (left != null && right != null && String(left) === String(right))
)

function filterOptions(options, query) {
  const normalizedQuery = normalizeSearchText(query)
  if (!normalizedQuery) return options
  return options.filter((option) => normalizeSearchText(option.label).includes(normalizedQuery))
}

function nextEnabledIndex(options, currentIndex, direction) {
  if (!options.length) return -1

  for (let offset = 1; offset <= options.length; offset += 1) {
    const index = (currentIndex + (offset * direction) + options.length) % options.length
    if (!options[index]?.disabled) return index
  }

  return -1
}

export function SearchableSelect({
  value = '',
  onChange,
  options = EMPTY_OPTIONS,
  placeholder = 'Chọn',
  loading = false,
  error = '',
  disabled = false,
  name,
  'aria-label': ariaLabel,
}) {
  const generatedId = useId()
  const rootRef = useRef(null)
  const triggerRef = useRef(null)
  const searchRef = useRef(null)
  const suppressFocusOpenRef = useRef(false)
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [activeIndex, setActiveIndex] = useState(-1)

  const safeOptions = Array.isArray(options) ? options : EMPTY_OPTIONS
  const filteredOptions = useMemo(() => filterOptions(safeOptions, query), [query, safeOptions])
  const selectedOption = safeOptions.find((option) => valuesMatch(option.value, value))
  const accessibleLabel = ariaLabel || name || 'Lựa chọn'
  const listboxId = `${generatedId}-listbox`
  const statusId = `${generatedId}-status`
  const activeOptionId = activeIndex >= 0 && filteredOptions[activeIndex]
    ? `${generatedId}-option-${activeIndex}`
    : undefined
  const isOpen = open && !disabled

  const closeDropdown = (restoreFocus = false) => {
    setOpen(false)
    setQuery('')
    setActiveIndex(-1)
    if (!restoreFocus) return

    suppressFocusOpenRef.current = true
    triggerRef.current?.focus({ preventScroll: true })
  }

  const openDropdown = (direction = 1) => {
    if (disabled || open) return
    const startingIndex = direction > 0 ? -1 : 0
    setQuery('')
    setActiveIndex(nextEnabledIndex(safeOptions, startingIndex, direction))
    setOpen(true)
  }

  useEffect(() => {
    if (!isOpen) return undefined
    searchRef.current?.focus({ preventScroll: true })

    const handlePointerDown = (event) => {
      if (!rootRef.current?.contains(event.target)) closeDropdown()
    }
    const handleEscape = (event) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      closeDropdown(true)
    }

    document.addEventListener('pointerdown', handlePointerDown)
    document.addEventListener('keydown', handleEscape)
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown)
      document.removeEventListener('keydown', handleEscape)
    }
  }, [isOpen])

  const handleTriggerFocus = () => {
    if (suppressFocusOpenRef.current) {
      suppressFocusOpenRef.current = false
      return
    }
    openDropdown()
  }

  const handleTriggerKeyDown = (event) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      openDropdown(event.key === 'ArrowDown' ? 1 : -1)
      return
    }
    if ((event.key === 'Enter' || event.key === ' ') && !isOpen) {
      event.preventDefault()
      openDropdown()
    }
  }

  const handleSearchChange = (event) => {
    const nextQuery = event.target.value
    const nextOptions = filterOptions(safeOptions, nextQuery)
    setQuery(nextQuery)
    setActiveIndex(nextEnabledIndex(nextOptions, -1, 1))
  }

  const moveActiveOption = (direction) => {
    const startingIndex = activeIndex >= 0 ? activeIndex : direction > 0 ? -1 : 0
    setActiveIndex(nextEnabledIndex(filteredOptions, startingIndex, direction))
  }

  const selectOption = (option, sourceEvent) => {
    if (!option || option.disabled || loading || error || disabled) return
    const changeTarget = { name, value: option.value }
    onChange?.({
      target: changeTarget,
      currentTarget: changeTarget,
      nativeEvent: sourceEvent?.nativeEvent,
      type: 'change',
    })
    closeDropdown(true)
  }

  const handleSearchKeyDown = (event) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      moveActiveOption(event.key === 'ArrowDown' ? 1 : -1)
      return
    }
    if (event.key !== 'Enter') return

    event.preventDefault()
    selectOption(filteredOptions[activeIndex], event)
  }

  const errorMessage = typeof error === 'string' && error.trim()
    ? error
    : 'Không thể tải danh sách lựa chọn.'

  return (
    <span
      ref={rootRef}
      className={`searchable-select ${disabled ? 'searchable-select--disabled' : ''} ${error ? 'searchable-select--error' : ''}`}
      aria-busy={loading || undefined}
    >
      {name && <input type="hidden" name={name} value={value ?? ''} />}
      <button
        ref={triggerRef}
        type="button"
        className="searchable-select__trigger"
        role="combobox"
        aria-label={accessibleLabel}
        aria-controls={isOpen ? listboxId : undefined}
        aria-expanded={isOpen}
        aria-haspopup="listbox"
        aria-invalid={Boolean(error) || undefined}
        aria-describedby={isOpen && error ? statusId : undefined}
        disabled={disabled}
        onFocus={handleTriggerFocus}
        onClick={() => openDropdown()}
        onKeyDown={handleTriggerKeyDown}
      >
        <span className={`searchable-select__value ${selectedOption ? '' : 'searchable-select__value--placeholder'}`}>
          {selectedOption?.label || placeholder}
        </span>
        <span className="searchable-select__chevron" aria-hidden="true">▾</span>
      </button>

      {isOpen && (
        <span className="searchable-select__panel">
          <span className="searchable-select__search-wrap">
            <input
              ref={searchRef}
              className="searchable-select__search"
              type="search"
              value={query}
              aria-label={`Tìm ${accessibleLabel}`}
              aria-controls={listboxId}
              aria-activedescendant={activeOptionId}
              autoComplete="off"
              disabled={loading || Boolean(error)}
              onChange={handleSearchChange}
              onKeyDown={handleSearchKeyDown}
            />
          </span>

          <span id={listboxId} className="searchable-select__list" role="listbox" aria-label={`${accessibleLabel} - danh sách`}>
            {error ? (
              <span id={statusId} className="searchable-select__state searchable-select__state--error" role="alert">
                {errorMessage}
              </span>
            ) : loading ? (
              <span className="searchable-select__state" role="status">Đang tải...</span>
            ) : filteredOptions.length ? filteredOptions.map((option, index) => {
              const selected = valuesMatch(option.value, value)
              return (
                <button
                  id={`${generatedId}-option-${index}`}
                  key={`${String(option.value)}-${index}`}
                  type="button"
                  className={`searchable-select__option ${activeIndex === index ? 'searchable-select__option--active' : ''}`}
                  role="option"
                  aria-selected={selected}
                  aria-disabled={option.disabled || undefined}
                  disabled={option.disabled}
                  onMouseEnter={() => setActiveIndex(index)}
                  onClick={(event) => selectOption(option, event)}
                >
                  <span>{option.label}</span>
                  {selected && <span className="searchable-select__check" aria-hidden="true">✓</span>}
                </button>
              )
            }) : (
              <span className="searchable-select__state" role="status">
                {query ? 'Không có lựa chọn phù hợp.' : 'Không có lựa chọn.'}
              </span>
            )}
          </span>
        </span>
      )}
    </span>
  )
}

export default SearchableSelect
