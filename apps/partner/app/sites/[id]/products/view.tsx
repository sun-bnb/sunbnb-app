'use client'

import { useState, useRef } from 'react'
import { useTranslations } from 'next-intl'
import { addProduct, getProducts, toggleAppSales, setOrderPaymentType } from './actions'
import { Product } from '@/types/shared'
import Button from '@mui/material/Button'
import TextField from '@mui/material/TextField'
import Collapse from '@mui/material/Collapse'
import Switch from '@mui/material/Switch'
import AddIcon from '@mui/icons-material/Add'
import CloseIcon from '@mui/icons-material/Close'
import ImageIcon from '@mui/icons-material/Image'
import Inventory2OutlinedIcon from '@mui/icons-material/Inventory2Outlined'
import PaymentsIcon from '@mui/icons-material/Payments'
import EventAvailableIcon from '@mui/icons-material/EventAvailable'
import { useSite } from '@/app/sites/site-context'
import ProductItem from './ProductItem'

export default function ProductsView() {

  const t = useTranslations('SiteProducts')
  const { site, setSite } = useSite()

  const [productList, setProductList] = useState<Product[]>(site.products || [])
  const [showAddForm, setShowAddForm] = useState(false)
  const [saving, setSaving] = useState(false)
  const [salesEnabled, setSalesEnabled] = useState(site.appSalesEnabled ?? false)
  const [togglingsales, setTogglingsales] = useState(false)
  const [orderBillingType, setOrderBillingType] = useState(site.orderPaymentType ?? site.type ?? 'paid')

  // Add form state
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [totalPrice, setTotalPrice] = useState('')
  const [tax, setTax] = useState('21')
  const [category, setCategory] = useState('food')
  const [prepTime, setPrepTime] = useState('')
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const formRef = useRef<HTMLFormElement>(null)

  const refreshProducts = async () => {
    const fetched = await getProducts(site.id!)
    setProductList(fetched)
  }

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0] ?? null
    setPreviewUrl(file ? URL.createObjectURL(file) : null)
  }

  const resetForm = () => {
    setName('')
    setDescription('')
    setTotalPrice('')
    setTax('21')
    setCategory('food')
    setPrepTime('')
    setPreviewUrl(null)
    formRef.current?.reset()
  }

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    setSaving(true)
    const formData = new FormData(e.currentTarget)
    await addProduct(formData)
    resetForm()
    setShowAddForm(false)
    setSaving(false)
    await refreshProducts()
  }

  const priceNum = parseFloat(totalPrice) || 0
  const taxNum = parseFloat(tax) || 0
  const priceBeforeTax = priceNum / (1 + taxNum / 100)

  const handleToggleSales = async (enabled: boolean) => {
    setTogglingsales(true)
    setSalesEnabled(enabled)
    await toggleAppSales(site.id!, enabled)
    setSite({ ...site, appSalesEnabled: enabled })
    setTogglingsales(false)
  }

  return (
    <div className="pt-2">
      {/* App sales toggle */}
      <div className="flex items-center justify-between bg-white border border-gray-200 rounded-lg px-4 py-3 mt-4 mb-2">
        <div>
          <p className="text-sm font-medium text-gray-800">{t('inAppSalesTitle')}</p>
          <p className="text-xs text-gray-500 mt-0.5">
            {t('inAppSalesDescription')}
          </p>
        </div>
        <Switch
          checked={salesEnabled}
          onChange={(e) => handleToggleSales(e.target.checked)}
          disabled={togglingsales}
          size="small"
          sx={{
            '& .MuiSwitch-switchBase.Mui-checked': { color: '#111827' },
            '& .MuiSwitch-switchBase.Mui-checked + .MuiSwitch-track': { backgroundColor: '#111827' },
          }}
        />
      </div>

      {/* Food order billing — only visible when sales enabled */}
      {salesEnabled && (
        <div className="mt-3 mb-2">
          <h3 className="text-sm font-medium text-gray-700 mb-2">{t('orderBilling')}</h3>
          <div className="flex gap-3">
            <button
              type="button"
              onClick={() => {
                setOrderBillingType('paid')
                setOrderPaymentType(site.id!, 'paid')
                setSite({ ...site, orderPaymentType: 'paid' })
              }}
              className={`flex-1 rounded-lg border-2 p-4 text-left transition-all ${
                orderBillingType === 'paid'
                  ? 'border-blue-500 bg-blue-50'
                  : 'border-gray-200 bg-white hover:border-gray-300'
              }`}
            >
              <div className="flex items-center gap-2 mb-1">
                <PaymentsIcon fontSize="small" className={orderBillingType === 'paid' ? 'text-blue-600' : 'text-gray-400'} />
                <span className={`font-medium text-sm ${orderBillingType === 'paid' ? 'text-blue-700' : 'text-gray-700'}`}>
                  {t('integratedPayments')}
                </span>
              </div>
              <p className="text-xs text-gray-500">
                {t('integratedPaymentsDescription')}
              </p>
            </button>
            <button
              type="button"
              onClick={() => {
                setOrderBillingType('unpaid')
                setOrderPaymentType(site.id!, 'unpaid')
                setSite({ ...site, orderPaymentType: 'unpaid' })
              }}
              className={`flex-1 rounded-lg border-2 p-4 text-left transition-all ${
                orderBillingType === 'unpaid'
                  ? 'border-blue-500 bg-blue-50'
                  : 'border-gray-200 bg-white hover:border-gray-300'
              }`}
            >
              <div className="flex items-center gap-2 mb-1">
                <EventAvailableIcon fontSize="small" className={orderBillingType === 'unpaid' ? 'text-blue-600' : 'text-gray-400'} />
                <span className={`font-medium text-sm ${orderBillingType === 'unpaid' ? 'text-blue-700' : 'text-gray-700'}`}>
                  {t('offPlatformBilling')}
                </span>
              </div>
              <p className="text-xs text-gray-500">
                {t('offPlatformBillingDescription')}
              </p>
            </button>
          </div>
        </div>
      )}

      {/* Header */}
      <div className="flex items-center justify-between mt-4 mb-6">
        <div>
          <h2 className="text-lg font-semibold text-gray-800">{t('productsTitle')}</h2>
          <p className="text-sm text-gray-500 mt-1">
            {t('productsSubtitle')}
          </p>
        </div>
        <Button
          size="small"
          variant={showAddForm ? 'text' : 'outlined'}
          startIcon={showAddForm ? <CloseIcon fontSize="small" /> : <AddIcon fontSize="small" />}
          onClick={() => {
            if (showAddForm) resetForm()
            setShowAddForm(!showAddForm)
          }}
          sx={{ textTransform: 'none', borderColor: '#d1d5db', color: '#374151' }}
        >
          {showAddForm ? t('cancel') : t('addProduct')}
        </Button>
      </div>

      {/* Add product form */}
      <Collapse in={showAddForm}>
        <div className="border border-gray-200 rounded-lg bg-white p-4 mb-6">
          <form ref={formRef} onSubmit={handleSubmit} encType="multipart/form-data">
            <input type="hidden" name="siteId" value={site.id} />

            <div className="flex gap-4">
              {/* Image upload */}
              <div
                className="w-20 h-20 rounded-lg bg-gray-100 flex-shrink-0 flex items-center justify-center overflow-hidden cursor-pointer border-2 border-dashed border-gray-300 hover:border-gray-400 transition-colors"
                onClick={() => fileRef.current?.click()}
              >
                {previewUrl ? (
                  <img src={previewUrl} alt="Preview" className="w-full h-full object-cover" />
                ) : (
                  <ImageIcon className="text-gray-300" fontSize="large" />
                )}
                <input
                  ref={fileRef}
                  type="file"
                  name="image"
                  accept="image/*"
                  hidden
                  onChange={handleFileChange}
                />
              </div>

              {/* Fields */}
              <div className="flex-1 grid grid-cols-2 gap-3">
                <TextField
                  name="name"
                  label={t('productName')}
                  size="small"
                  required
                  fullWidth
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  sx={{ gridColumn: '1 / -1' }}
                />
                <TextField
                  name="description"
                  label={t('descriptionOptional')}
                  size="small"
                  fullWidth
                  multiline
                  minRows={1}
                  maxRows={2}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  sx={{ gridColumn: '1 / -1' }}
                />
                <TextField
                  name="totalPrice"
                  label={t('totalPrice')}
                  size="small"
                  type="number"
                  required
                  value={totalPrice}
                  onChange={(e) => setTotalPrice(e.target.value)}
                  inputProps={{ step: '0.01' }}
                />
                <TextField
                  name="tax"
                  label={t('taxPercent')}
                  size="small"
                  type="number"
                  required
                  value={tax}
                  onChange={(e) => setTax(e.target.value)}
                  inputProps={{ step: '0.01' }}
                />
                <TextField
                  name="category"
                  label={t('productCategory')}
                  size="small"
                  select
                  value={category}
                  onChange={(e) => setCategory(e.target.value)}
                  SelectProps={{ native: true }}
                >
                  <option value="food">{t('food')}</option>
                  <option value="drink">{t('drink')}</option>
                  <option value="snack">{t('snack')}</option>
                  <option value="accessory">{t('accessory')}</option>
                </TextField>
                <TextField
                  name="prepTime"
                  label={t('prepTime')}
                  size="small"
                  type="number"
                  value={prepTime}
                  onChange={(e) => setPrepTime(e.target.value)}
                  inputProps={{ min: 0, step: 1 }}
                />
              </div>
            </div>

            {priceNum > 0 && (
              <div className="text-xs text-gray-400 mt-2 ml-24">
                {t('priceBeforeTax', { amount: priceBeforeTax.toFixed(2) })}
              </div>
            )}

            <div className="flex justify-end mt-4">
              <Button
                type="submit"
                variant="contained"
                size="small"
                disabled={saving || !name || !totalPrice}
                sx={{ textTransform: 'none', backgroundColor: '#111827', '&:hover': { backgroundColor: '#374151' } }}
              >
                {saving ? t('adding') : t('addProduct')}
              </Button>
            </div>
          </form>
        </div>
      </Collapse>

      {/* Product list */}
      {productList.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-gray-400">
          <Inventory2OutlinedIcon sx={{ fontSize: 48, mb: 1, color: '#d1d5db' }} />
          <p className="text-sm">{t('noProductsTitle')}</p>
          <p className="text-xs mt-1">{t('noProductsSubtitle')}</p>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {productList.map((product) => (
            <ProductItem
              key={product.id}
              product={product}
              onUpdated={refreshProducts}
            />
          ))}
        </div>
      )}

      {/* Summary */}
      {productList.length > 0 && (
        <div className="mt-4 text-xs text-gray-400 text-right">
          {t('productCount', { count: productList.length })}
        </div>
      )}
    </div>
  )
}
