'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
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
import { get } from 'http'

export default function ProductManagementPage({
  siteId,
  products,
}: {
  siteId: string
  products: Product[]
}) {
  const router = useRouter()
  const [productList, setProductList] = useState<Product[]>(products)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  const handleDelete = async (id: string) => {
    await deleteProduct(id)
    const fetched = await getProducts(siteId)
    setProductList(fetched)
  }

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0] ?? null
    if (file) {
      setPreviewUrl(URL.createObjectURL(file))
    } else {
      setPreviewUrl(null)
    }
  }

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    const formEl = e.currentTarget
    const formData = new FormData(formEl)
    await addProduct(formData)
    startTransition(async () => {
      // reset UI
      formEl.reset()
      setPreviewUrl(null)
      // re-fetch the list props for this page
      getProducts(siteId).then((fetched) => {
        console.log('Fetched products:', fetched)
        setProductList(fetched)
      })
    })
  }

  return (
    <Box maxWidth="800px" mx="auto" p={2}>
      <Paper sx={{ p: 2, mb: 4 }}>
        <form
          onSubmit={handleSubmit}
          encType="multipart/form-data"
          className="flex flex-wrap gap-2 items-center"
        >
          <input type="hidden" name="siteId" value={siteId} />

          <TextField name="name" label="Name" required />
          <TextField name="description" label="Description" />

          <TextField
            name="totalPrice"
            label="Total Price (with tax)"
            type="number"
            required
            inputProps={{ step: '0.01' }}
          />

          <TextField
            name="tax"
            label="Tax %"
            type="number"
            required
            inputProps={{ step: '0.01' }}
          />

          <Button
            component="label"
            variant="outlined"
          >
            {previewUrl ? (
              <Box
                component="img"
                src={previewUrl}
                alt="Preview"
                sx={{ width: '100px', height: '100px', objectFit: 'cover' }}
              />
            ) : (
              'Select Image'
            )}
            <input
              type="file"
              name="image"
              accept="image/*"
              hidden
              onChange={handleFileChange}
            />
          </Button>

          <Button type="submit" variant="contained" disabled={isPending}>
            {isPending ? 'Adding…' : 'Add Product'}
          </Button>
        </form>
      </Paper>

      {/* Product List */}
      <Paper>
        <Table>
          <TableHead>
            <TableRow>
              <TableCell>Image</TableCell>
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
                <TableCell colSpan={7} align="center">
                  No products
                </TableCell>
              </TableRow>
            ) : (
              productList.map((prod) => (
                <TableRow key={prod.id}>
                  <TableCell>
                    {prod.imageUrl && (
                      <img src={prod.imageUrl} alt={prod.name} width={50} />
                    )}
                  </TableCell>
                  <TableCell>{prod.name}</TableCell>
                  <TableCell>{prod.description}</TableCell>
                  <TableCell align="right">
                    {prod.price.toFixed(2)}
                  </TableCell>
                  <TableCell align="right">
                    {prod.tax.toFixed(2)}
                  </TableCell>
                  <TableCell align="right">
                    {prod.totalPrice.toFixed(2)}
                  </TableCell>
                  <TableCell align="center">
                    <IconButton
                      color="error"
                      onClick={() => handleDelete(prod.id)}
                    >
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
