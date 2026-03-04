'use client'

import logger from '@/utils/logger'

import { v4 as uuidv4 } from 'uuid'
import { useEffect, useState } from 'react'
import { getProducts, createOrder, getOrders } from './actions'
import { Product, Invoice } from '@/app/types/types'
import {
  Box,
  Grid,
  Card,
  CardMedia,
  Typography,
  IconButton,
  Button,
  Badge,
  Drawer,
  List,
  ListItem,
  ListItemText,
  Divider,
  Stack,
  CircularProgress,
  Snackbar,
  Alert,
} from '@mui/material'
import AddIcon from '@mui/icons-material/Add'
import ListAltIcon from '@mui/icons-material/ListAlt'
import RemoveIcon from '@mui/icons-material/Remove'
import ShoppingCartIcon from '@mui/icons-material/ShoppingCart'
import { useSession } from 'next-auth/react'
import { useDispatch, useSelector } from 'react-redux'
import { RootState } from '@/store/store'
import { setValue } from '@/store/features/reservation/reservationSlice'
import { useGetOrderByIdQuery } from '@/store/features/api/apiSlice'
import OrderPaymentView from '@/app/payment/OrderPayment'
import Orders from './Orders'

interface OrderItem {
  product: Product
  quantity: number
}

function OrderButton({
  disabled,
  items,
  siteId,
  reservationId,
  seatId
}: {
  disabled: boolean,
  items: OrderItem[],
  siteId: string,
  reservationId: string
  seatId?: string
}) {

  const { data: session } = useSession()

  const dispatch = useDispatch();
  const reservationState = useSelector((state: RootState) => state.reservation)

  return (
    <div className="mt-[8px]">
      <Button style={{
      }} variant="contained"
        fullWidth={true}
        disabled={disabled}
        onClick={
          async () => {
            dispatch(setValue({ orderState: 'saving' }))
            logger.debug('Order ITEMS', items)

            let saveResult = null

            let anonId = undefined
            if (!(session?.user?.id)) {
              anonId = localStorage.getItem('sunbnb-anonId')
              if (!anonId) {
                anonId = uuidv4()
                localStorage.setItem('sunbnb-anonId', anonId)
              }
            }
            
            saveResult = await createOrder({
              items: items,
              siteId,
              anonId,
              reservationId,
              seatId
            })

            logger.debug('Save order result', saveResult)
            if (saveResult?.status === 'ok' && saveResult.id) {
              dispatch(setValue({ 
                orderState: 'processing',
                pendingOrderId: saveResult.id,
                panelBottom: 'bottom-[0px]'
              }))
            }

          }
        }>
          PLACE ORDER
        </Button>
    </div>
  )
}

export default function Menu({ siteId, reservationId, seatId, apiKey, serviceFee, stripePublicKey, orders, showConfirmation }: { 
  siteId: string,
  reservationId: string,
  seatId?: string,
  apiKey: string,
  stripePublicKey: string | undefined,
  serviceFee: number,
  orders?: { 
    id: string,
    createdAt: Date,
    totalPrice: number,
    status: string,
    orderItems: { 
      id: string
      name: string
      quantity: number
      price: number
      tax: number
      totalPrice: number
    }[],
    invoice?: Invoice | null
  }[] | null,
  showConfirmation?: boolean
}) {

  const [products, setProducts] = useState<Product[]>([])
  const [basket, setBasket] = useState<Array<{ product: Product; quantity: number }>>([])
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [drawerContent, setDrawerContent] = useState<string>('new-order')

  const [openConfirmation, setOpenConfirmation] = useState(showConfirmation || false)

  const [currentOrders, setCurrentOrders] = useState(orders || [])

  // optional: auto‐close after 3s
  useEffect(() => {
    if (!showConfirmation) return
    const timer = setTimeout(() => setOpenConfirmation(false), 3000)
    return () => clearTimeout(timer)
  }, [])

  const reservationState = useSelector((state: RootState) => state.reservation)
  const { orderState, pendingOrderId } = reservationState

  if (!stripePublicKey) {
    return (
      <div className="flex flex-col items-center justify-center">
        <div>Payment gateway unavailable</div>
      </div>
    )
  }

  const { data: order } = useGetOrderByIdQuery({ id: pendingOrderId }, {
    skip: !pendingOrderId
  })
  
  logger.debug('Order By Id', pendingOrderId, order)
  
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

  const previewElem = !order ? (
    <Box p={2} height={'50dvh'} display="flex" flexDirection="column">
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
          Total: {(totalPrice + serviceFee).toFixed(2)} €
        </Typography>
        <OrderButton disabled={false} items={basket} siteId={siteId} reservationId={reservationId} seatId={seatId} />
      </Stack>
    </Box>
  ) : (
    <Box py={2} px={'8px'} height={'auto'} display="flex" flexDirection="row" justifyContent="space-between" alignItems="center">
      <Typography variant="h6">Order payment</Typography>
      <Typography variant="h6">
        {(totalPrice + serviceFee).toFixed(2)} €
      </Typography>
    </Box>
  )

  const anonId = localStorage.getItem('sunbnb-anonId')

  const paymentElem =
    (orderState === 'processing' || orderState === 'payment_in_progress') ? (
      !order ? (
        <div className="flex justify-center mb-[12px] mt-[24px]">
          <CircularProgress />
        </div>
      ) : <OrderPaymentView 
            stripePublicKey={stripePublicKey}
            preview={previewElem}
            completeUrl={`/reservations/${reservationId}${anonId ? `?anonId=${anonId}` : ''}`}
            serviceFee={serviceFee}
            order={order} />

    ) : (
      <div className="mx-[4px]">
        {previewElem}
      </div>
    )
    
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

      <Snackbar
        open={openConfirmation}
        onClose={() => setOpenConfirmation(false)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
        sx={{ bottom: 112 }}
      >
        <Alert
          onClose={() => setOpenConfirmation(false)}
          severity="success"
          sx={{ width: 'calc(100% - 18px)' }}
        >
          Order received
        </Alert>
      </Snackbar>

      {/* Basket summary button */}
      <Box
        position="fixed"
        bottom={48}
        left={0}
        right={0}
        pr={'16px'}
        pl={'12px'}
        py={'8px'}
        sx={{ display: 'flex', gap: 1, backgroundColor: 'white' }}
      >
        {/* Left: big checkout button */}
        <Button
          variant="contained"
          color="primary"
          sx={{ flex: 1 }}
          onClick={() => {
            setDrawerContent('new-order')
            setDrawerOpen(true)
          }}
          disabled={basket.length === 0}
          startIcon={
            <Badge badgeContent={totalItems} color="secondary">
              <ShoppingCartIcon />
            </Badge>
          }
        >
          Checkout – {(totalPrice + serviceFee).toFixed(2)} €
        </Button>

        {/* Right: orders overview */}
          <IconButton
            size="medium"
            color="primary"
            onClick={() => {
              getOrders({ reservationId: reservationId }).then((result) => {
                if (Array.isArray(result)) {
                  logger.debug('Fetched orders', result)
                  setCurrentOrders(result)
                }
              })
              setDrawerContent('orders')
              setDrawerOpen(true)
            }}
          >
            {
              currentOrders && currentOrders.length > 0 ? (
                <Badge badgeContent={currentOrders.length} color="error">
                  <ListAltIcon fontSize="medium" />
                </Badge>
              ) : (
                <ListAltIcon fontSize="medium" />
              )
            }
            
          </IconButton>
      </Box>

      {/* Drawer for basket details */}
      <Drawer
        anchor="bottom"
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
      >
        { 
          drawerContent === 'new-order' ? 
            paymentElem : 
              <div>
                {
                  <Orders orders={(currentOrders || [])} />
                }
              </div>
        }
      </Drawer>
    </Box>
  )
}
