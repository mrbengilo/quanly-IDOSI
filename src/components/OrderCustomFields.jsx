import { Field, Input, Select } from './UI'
import {
  customFieldOptions,
  ORDER_CUSTOM_FIELD_TYPE,
} from '../domain/orderInformationSettings'
import {
  normalizeOrderCustomFields,
  orderCustomFieldDisplayValue,
} from '../domain/orderCustomFields'
import './orderItems.css'

const fieldValueMap = (values = []) => new Map((Array.isArray(values) ? values : [])
  .map((entry) => [String(entry.fieldId || entry.id || ''), entry.value]))

export function OrderCustomFieldsEditor({ options, value = [], errors = {}, error = '', disabled = false, onChange }) {
  const definitions = customFieldOptions(options)
  if (!definitions.length) return null
  const values = Array.isArray(value) ? value : []
  const byId = fieldValueMap(values)
  const update = (definition, nextValue) => {
    const fieldId = String(definition.id)
    const remaining = values.filter((entry) => String(entry.fieldId || entry.id || '') !== fieldId)
    const empty = nextValue === undefined || nextValue === null || nextValue === ''
    onChange?.(empty ? remaining : [...remaining, { fieldId, value: nextValue }])
  }

  return <div className="order-custom-fields" aria-label="Thuộc tính bổ sung của đơn hàng">
    <div className="order-custom-fields__heading">
      <strong>Thông tin bổ sung</strong>
      <small>Các thuộc tính do Admin cấu hình.</small>
    </div>
    <div className="order-custom-fields__grid">
      {definitions.map((definition) => {
        const fieldId = String(definition.id)
        const rawValue = byId.has(fieldId) ? byId.get(fieldId) : ''
        const common = {
          disabled,
          value: rawValue === undefined || rawValue === null ? '' : String(rawValue),
          onChange: (event) => update(definition, event.target.value),
          'aria-label': definition.label,
        }
        return <Field key={fieldId} label={definition.label} required={definition.required} error={errors[fieldId]}>
          {definition.fieldType === ORDER_CUSTOM_FIELD_TYPE.SELECT
            ? <Select {...common}><option value="">Chọn</option>{definition.choices.map((choice) => <option key={choice}>{choice}</option>)}</Select>
            : definition.fieldType === ORDER_CUSTOM_FIELD_TYPE.BOOLEAN
              ? <Select {...common}><option value="">Chọn</option><option value="true">Có</option><option value="false">Không</option></Select>
              : <Input {...common} type={definition.fieldType === ORDER_CUSTOM_FIELD_TYPE.NUMBER ? 'number' : definition.fieldType === ORDER_CUSTOM_FIELD_TYPE.DATE ? 'date' : 'text'} />}
        </Field>
      })}
    </div>
    {error && <small className="field__error" role="alert">{error}</small>}
  </div>
}

export function OrderCustomFieldsSummary({ values = [] }) {
  const normalized = normalizeOrderCustomFields(values)
  if (!normalized.length) return <span className="order-custom-fields-summary--empty">Không có</span>
  return <dl className="order-custom-fields-summary">
    {normalized.map((entry) => <div key={entry.fieldId}>
      <dt>{entry.fieldLabel}</dt>
      <dd>{orderCustomFieldDisplayValue(entry)}</dd>
    </div>)}
  </dl>
}
