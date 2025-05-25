'use client'

import { useState, ChangeEvent, FormEvent } from 'react'
import { addProduct, deleteProduct, getProducts } from './actions'
import { Product } from '@/types/shared'
import {
  Paper,
  Table,
  TableHead,
  TableRow,
  TableCell,
  TableBody,
  TextField,
  Button,
  IconButton,
  Box,
  Typography,
} from '@mui/material'

import DeleteIcon from '@mui/icons-material/Delete'

export default function ProductManagementPage({ siteId, products }: { siteId: string; products: Product[] }) {

  const [productList, setProductList] = useState<Product[]>(products)
  const [form, setForm] = useState({ name: '', description: '', totalPrice: '', tax: '' })

  const handleChange = (e: ChangeEvent<HTMLInputElement>) => {
    setForm(prev => ({ ...prev, [e.target.name]: e.target.value }))
  }

  const handleAdd = (e: FormEvent) => {
    e.preventDefault()
    const totalPrice = parseFloat(form.totalPrice)
    const taxPercent = parseFloat(form.tax)
    const newItem = {
      siteId,
      name: form.name,
      description: form.description || undefined,
      tax: taxPercent,
      totalPrice: +totalPrice.toFixed(2),
    }

    addProduct(newItem).then(() => {
      getProducts(siteId).then(fetchedProducts => {
        setProductList(fetchedProducts)
      })
    })

  }

  const handleDelete = (id: string) => {
    deleteProduct(id).then(() => {
      getProducts(siteId).then(fetchedProducts => {
        setProductList(fetchedProducts)
      })
    })
  }

  return (
    <Box maxWidth="800px" mx="auto" p={2}>
      {/* Add Form */}
      <Paper sx={{ p: 2, mb: 4 }}>
        <form onSubmit={handleAdd} className="flex flex-wrap gap-2">
          <TextField
            name="name"
            label="Name"
            required
            value={form.name}
            onChange={handleChange}
          />
          <TextField
            name="description"
            label="Description"
            value={form.description}
            onChange={handleChange}
          />
          <TextField
            name="totalPrice"
            label="Total Price (with tax)"
            type="number"
            required
            inputProps={{ step: '0.01' }}
            value={form.totalPrice}
            onChange={handleChange}
          />
          <TextField
            name="tax"
            label="Tax %"
            type="number"
            required
            inputProps={{ step: '0.01' }}
            value={form.tax}
            onChange={handleChange}
          />
          <Button type="submit" variant="contained">
            Add Product
          </Button>
        </form>
      </Paper>

      {/* Product List */}
      <Paper>
        <Table>
          <TableHead>
            <TableRow>
              <TableCell>Name</TableCell>
              <TableCell>Description</TableCell>
              <TableCell align="right">Price<br/>(before tax)</TableCell>
              <TableCell align="right">Tax (%)</TableCell>
              <TableCell align="right">Total<br/>(after tax)</TableCell>
              <TableCell align="center">Actions</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {productList.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} align="center">
                  No products
                </TableCell>
              </TableRow>
            ) : (
              productList.map(prod => (
                <TableRow key={prod.id}>
                  <TableCell>{prod.name}</TableCell>
                  <TableCell>{prod.description}</TableCell>
                  <TableCell align="right">{prod.price.toFixed(2)}</TableCell>
                  <TableCell align="right">{prod.tax.toFixed(2)}</TableCell>
                  <TableCell align="right">{prod.totalPrice.toFixed(2)}</TableCell>
                  <TableCell align="center">
                    <IconButton color="error" onClick={() => handleDelete(prod.id)}>
                      <DeleteIcon />
                    </IconButton>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </Paper>
    </Box>
  )
}
