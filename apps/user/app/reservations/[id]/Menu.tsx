'use client'

import { useEffect, useState } from 'react'
import { getProducts, createOrder } from './actions'
import { Product } from '@/app/types/types'
import {
  Box,
  Grid,
  Card,
  CardMedia,
  CardContent,
  Typography,
  CardActions,
  IconButton,
  Button,
  Badge,
  Drawer,
  List,
  ListItem,
  ListItemText,
  Divider,
  Stack,
} from '@mui/material'
import AddIcon from '@mui/icons-material/Add'
import RemoveIcon from '@mui/icons-material/Remove'
import ShoppingCartIcon from '@mui/icons-material/ShoppingCart'

export default function Menu({ siteId }: { siteId: string }) {
  const [products, setProducts] = useState<Product[]>([])
  const [basket, setBasket] = useState<Array<{ product: Product; quantity: number }>>([])
  const [drawerOpen, setDrawerOpen] = useState(false)

  useEffect(() => {
    getProducts(siteId).then(fetched => setProducts(fetched))
  }, [siteId])

  const updateQuantity = (product: Product, delta: number) => {
    setBasket(prev => {
      const idx = prev.findIndex(item => item.product.id === product.id)
      if (idx > -1) {
        const updated = [...prev]
        const newQty = updated[idx]!.quantity + delta
        if (newQty <= 0) {
          updated.splice(idx, 1)
        } else {
          updated[idx] = { product, quantity: newQty }
        }
        return updated
      } else if (delta > 0) {
        return [...prev, { product, quantity: delta }]
      }
      return prev
    })
  }

  const totalItems = basket.reduce((sum, item) => sum + item.quantity, 0)
  const totalPrice = basket.reduce(
    (sum, item) => sum + item.quantity * item.product.totalPrice,
    0
  )

  const handlePlaceOrder = async () => {
    const orderItems = basket.map(item => ({ productId: item.product.id, quantity: item.quantity }))
    await createOrder({ siteId, items: orderItems })
    setBasket([])
    setDrawerOpen(false)
  }

  return (
    <Box p={2} pt={2}>
      <Grid container spacing={2} className="mb-[64px]">
        {products.map(product => (
          <Grid item xs={12} sm={6} md={4} key={product.id}>
            <Card sx={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
              {/* Top row: Image + Title/Description */}
              <Box sx={{ display: 'flex', flex: 1, p: 1 }}>
                {product.imageUrl && (
                  <CardMedia
                    component="div"
                    sx={{
                      width: 100,
                      height: 100,
                      overflow: 'hidden',
                      flexShrink: 0,
                      display: 'flex',
                      justifyContent: 'center',
                      alignItems: 'center',
                      mr: 1,
                    }}
                  >
                    <Box
                      component="img"
                      src={product.imageUrl}
                      alt={product.name}
                      sx={{ maxWidth: '100%', height: 'auto', display: 'block' }}
                    />
                  </CardMedia>
                )}
                <Box sx={{ display: 'flex', flexDirection: 'column', justifyContent: 'start' }}>
                  <Typography variant="h6" noWrap>
                    {product.name}
                  </Typography>
                  {product.description && (
                    <Typography variant="body2" color="textSecondary">
                      {product.description}
                    </Typography>
                  )}
                </Box>
              </Box>
              {/* Bottom row: Price and quantity controls */}
              <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', pl: '12px' }}>
                <Typography variant="subtitle1">
                  {product.totalPrice.toFixed(2)} €
                </Typography>
                <Box sx={{ display: 'flex', alignItems: 'center' }}>
                  <IconButton onClick={() => updateQuantity(product, -1)}>
                    <RemoveIcon />
                  </IconButton>
                  <Typography sx={{ mx: 1 }}>
                    {basket.find(b => b.product.id === product.id)?.quantity ?? 0}
                  </Typography>
                  <IconButton onClick={() => updateQuantity(product, 1)}>
                    <AddIcon />
                  </IconButton>
                </Box>
              </Box>
            </Card>
          </Grid>
        ))}
      </Grid>

      {/* Basket summary button */}
      <Box position="fixed" bottom={64} left={16} right={16}>
        <Button
          variant="contained"
          color="primary"
          fullWidth
          onClick={() => setDrawerOpen(true)}
          disabled={basket.length === 0}
          startIcon={
            <Badge badgeContent={totalItems} color="secondary">
              <ShoppingCartIcon />
            </Badge>
          }
        >
          Checkout – {totalPrice.toFixed(2)} €
        </Button>
      </Box>

      {/* Drawer for basket details */}
      <Drawer
        anchor="bottom"
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
      >
        <Box p={2} height="50dvh" display="flex" flexDirection="column">
          <Typography variant="h6">Order confirmation</Typography>
          <Divider sx={{ my: 1 }} />
          <Box flex={1} overflow="auto">
            <List>
              {basket.map(item => (
                <ListItem key={item.product.id}>
                  <ListItemText
                    primary={`${item.product.name} x ${item.quantity}`}
                    secondary={`${(
                      item.product.totalPrice * item.quantity
                    ).toFixed(2)} €`}
                  />
                </ListItem>
              ))}
            </List>
          </Box>
          <Divider />
          <Stack
            direction="row"
            justifyContent="space-between"
            alignItems="center"
            mt={2}
          >
            <Typography variant="subtitle1">
              Total: {totalPrice.toFixed(2)} €
            </Typography>
            <Button
              variant="contained"
              onClick={handlePlaceOrder}
            >
              Place Order
            </Button>
          </Stack>
        </Box>
      </Drawer>
    </Box>
  )
}
