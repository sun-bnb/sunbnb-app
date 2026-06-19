'use client'

import { useEffect, useState, useRef } from 'react'
import { useTranslations } from 'next-intl'
import {
  getEmployees,
  createEmployee,
  renameEmployee,
  setEmployeeActive,
  deleteEmployee,
} from './actions'

interface Employee {
  id: string
  name: string
  active: boolean
  createdAt: string | Date
}

function ActiveBadge({ active }: { active: boolean }) {
  const t = useTranslations('Staff')
  return (
    <span
      className={`inline-flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-full ${
        active
          ? 'bg-green-50 text-green-700'
          : 'bg-gray-100 text-gray-500'
      }`}
    >
      <span
        className={`w-1.5 h-1.5 rounded-full ${active ? 'bg-green-500' : 'bg-gray-400'}`}
      />
      {active ? t('active') : t('inactive')}
    </span>
  )
}

function EmployeeRow({
  employee,
  onRenamed,
  onToggleActive,
  onDeleted,
}: {
  employee: Employee
  onRenamed: (id: string, name: string) => void
  onToggleActive: (id: string, active: boolean) => void
  onDeleted: (id: string) => void
}) {
  const t = useTranslations('Staff')
  const [editing, setEditing] = useState(false)
  const [draftName, setDraftName] = useState(employee.name)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (editing) inputRef.current?.focus()
  }, [editing])

  async function handleRename() {
    if (draftName.trim() === employee.name) {
      setEditing(false)
      return
    }
    setSaving(true)
    setError(null)
    const res = await renameEmployee(employee.id, draftName)
    setSaving(false)
    if (res.status === 'error') {
      setError(res.errors?.[0] ?? t('saveError'))
      return
    }
    onRenamed(employee.id, draftName.trim())
    setEditing(false)
  }

  async function handleToggleActive() {
    await setEmployeeActive(employee.id, !employee.active)
    onToggleActive(employee.id, !employee.active)
  }

  async function handleDelete() {
    if (!confirm(t('deleteConfirmBody'))) return
    await deleteEmployee(employee.id)
    onDeleted(employee.id)
  }

  return (
    <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
      <div className="flex items-center gap-3 px-5 py-3.5">
        {/* Name / inline edit */}
        <div className="flex-1 min-w-0">
          {editing ? (
            <div className="flex items-center gap-2">
              <input
                ref={inputRef}
                type="text"
                value={draftName}
                onChange={(e) => setDraftName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleRename()
                  if (e.key === 'Escape') {
                    setDraftName(employee.name)
                    setEditing(false)
                  }
                }}
                className="input flex-1 py-1 text-sm"
                maxLength={80}
                disabled={saving}
              />
              <button
                onClick={handleRename}
                disabled={saving}
                className="text-xs font-medium text-gray-700 hover:text-gray-900 disabled:opacity-40"
              >
                {saving ? t('saving') : t('save')}
              </button>
              <button
                onClick={() => {
                  setDraftName(employee.name)
                  setEditing(false)
                  setError(null)
                }}
                className="text-xs text-gray-400 hover:text-gray-600"
              >
                {t('cancel')}
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-2 flex-wrap">
              <button
                onClick={() => setEditing(true)}
                className="text-sm font-medium text-gray-800 hover:text-gray-600 transition-colors text-left"
                title={t('renameTitle')}
              >
                {employee.name}
              </button>
              <ActiveBadge active={employee.active} />
            </div>
          )}
          {error && (
            <p className="text-[11px] text-red-600 mt-1">{error}</p>
          )}
        </div>

        {/* Actions */}
        <div className="flex items-center gap-1 flex-shrink-0">
          {/* Activate / deactivate toggle */}
          <button
            onClick={handleToggleActive}
            className="text-xs font-medium text-gray-500 hover:text-gray-800 px-2 py-1 rounded-md hover:bg-gray-100 transition-colors"
            title={employee.active ? t('deactivateTitle') : t('activateTitle')}
          >
            {employee.active ? t('deactivate') : t('activate')}
          </button>

          {/* Delete */}
          <button
            onClick={handleDelete}
            className="text-gray-300 hover:text-red-500 transition-colors p-1"
            title={t('deleteTitle')}
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  )
}

export default function StaffView() {
  const t = useTranslations('Staff')
  const [employees, setEmployees] = useState<Employee[]>([])
  const [newName, setNewName] = useState('')
  const [adding, setAdding] = useState(false)
  const [showAddForm, setShowAddForm] = useState(false)
  const [successMsg, setSuccessMsg] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const addInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    getEmployees().then(setEmployees)
  }, [])

  useEffect(() => {
    if (showAddForm) addInputRef.current?.focus()
  }, [showAddForm])

  async function handleAdd() {
    setAdding(true)
    setError(null)
    setSuccessMsg(null)
    const res = await createEmployee(newName)
    setAdding(false)
    if (res.status === 'error') {
      setError(res.errors?.[0] ?? t('addError'))
      return
    }
    setSuccessMsg(t('addSuccess', { name: newName.trim() }))
    setNewName('')
    setShowAddForm(false)
    const updated = await getEmployees()
    setEmployees(updated)
  }

  function handleRenamed(id: string, name: string) {
    setEmployees((prev) =>
      prev.map((e) => (e.id === id ? { ...e, name } : e))
    )
  }

  function handleToggleActive(id: string, active: boolean) {
    setEmployees((prev) =>
      prev.map((e) => (e.id === id ? { ...e, active } : e))
    )
  }

  function handleDeleted(id: string) {
    setEmployees((prev) => prev.filter((e) => e.id !== id))
  }

  const activeCount = employees.filter((e) => e.active).length

  return (
    <div className="container mx-auto px-4 py-6 max-w-3xl">

      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <div>
          <h1 className="text-lg font-semibold text-gray-900">{t('title')}</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            {t('headerSub', { count: employees.length, active: activeCount })}
          </p>
        </div>
        <button
          onClick={() => {
            setShowAddForm(true)
            setError(null)
          }}
          className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium text-white bg-gray-900 rounded-lg hover:bg-gray-800 transition-colors"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
          </svg>
          {t('addStaff')}
        </button>
      </div>

      {/* Intro / help */}
      <div className="bg-blue-50 border border-blue-200 rounded-xl px-4 py-3 mb-6 text-sm text-blue-900">
        <p className="font-medium mb-1">{t('introTitle')}</p>
        <p className="text-blue-800/90 leading-relaxed">{t('intro')}</p>
      </div>

      {/* Add-staff form */}
      {showAddForm && (
        <div className="mb-4 bg-white rounded-xl border border-gray-200 px-5 py-4">
          <p className="text-sm font-medium text-gray-800 mb-3">{t('addFormTitle')}</p>
          <div className="flex items-center gap-2">
            <input
              ref={addInputRef}
              type="text"
              placeholder={t('namePlaceholder')}
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleAdd()
                if (e.key === 'Escape') {
                  setShowAddForm(false)
                  setNewName('')
                  setError(null)
                }
              }}
              maxLength={80}
              disabled={adding}
              className="input flex-1"
            />
            <button
              onClick={handleAdd}
              disabled={adding || !newName.trim()}
              className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium text-white bg-gray-900 rounded-lg hover:bg-gray-800 disabled:opacity-40 transition-colors"
            >
              {adding ? t('adding') : t('add')}
            </button>
            <button
              onClick={() => {
                setShowAddForm(false)
                setNewName('')
                setError(null)
              }}
              className="text-sm text-gray-400 hover:text-gray-600 px-2"
            >
              {t('cancel')}
            </button>
          </div>
        </div>
      )}

      {/* Success banner */}
      {successMsg && (
        <div className="mb-6 bg-green-50 border border-green-200 rounded-xl p-4 flex items-start gap-3" role="status">
          <svg className="w-5 h-5 text-green-600 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75 11.25 15 15 9.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
          </svg>
          <p className="text-sm text-green-800 flex-1">{successMsg}</p>
          <button onClick={() => setSuccessMsg(null)} className="text-green-400 hover:text-green-600 flex-shrink-0">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      )}

      {/* Error banner */}
      {error && (
        <div className="mb-6 bg-red-50 border border-red-200 rounded-xl p-4 flex items-center gap-3" role="alert">
          <svg className="w-5 h-5 text-red-500 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9 3.75h.008v.008H12v-.008Z" />
          </svg>
          <p className="text-sm text-red-700">{error}</p>
          <button onClick={() => setError(null)} className="ml-auto text-red-400 hover:text-red-600">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      )}

      {/* Employee list */}
      {employees.length > 0 ? (
        <div className="space-y-3">
          {employees.map((employee) => (
            <EmployeeRow
              key={employee.id}
              employee={employee}
              onRenamed={handleRenamed}
              onToggleActive={handleToggleActive}
              onDeleted={handleDeleted}
            />
          ))}
        </div>
      ) : (
        <div className="text-center py-16 border border-dashed border-gray-300 rounded-xl">
          <svg
            className="mx-auto w-10 h-10 text-gray-300 mb-3"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={1.5}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19.128a9.38 9.38 0 0 0 2.625.372 9.337 9.337 0 0 0 4.121-.952 4.125 4.125 0 0 0-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 0 1 8.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0 1 11.964-3.07M12 6.375a3.375 3.375 0 1 1-6.75 0 3.375 3.375 0 0 1 6.75 0Zm8.25 2.25a2.625 2.625 0 1 1-5.25 0 2.625 2.625 0 0 1 5.25 0Z" />
          </svg>
          <p className="text-sm text-gray-500 mb-4">{t('noStaff')}</p>
          <button
            onClick={() => setShowAddForm(true)}
            className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium text-white bg-gray-900 rounded-lg hover:bg-gray-800 transition-colors"
          >
            {t('addFirst')}
          </button>
        </div>
      )}
    </div>
  )
}
