import { Resend } from 'resend'

let _resend: Resend | null = null

function getResend(): Resend {
  if (!_resend) {
    const key = process.env.RESEND_API_KEY
    if (!key) throw new Error('RESEND_API_KEY is not set')
    _resend = new Resend(key)
  }
  return _resend
}

const FROM_EMAIL = 'Sunbnb <noreply@sunbnb.app>'

export async function sendEmail({
  to,
  subject,
  html,
}: {
  to: string
  subject: string
  html: string
}) {
  const { data, error } = await getResend().emails.send({
    from: FROM_EMAIL,
    to,
    subject,
    html,
  })

  if (error) {
    console.error('Failed to send email:', error)
    throw new Error(`Email send failed: ${error.message}`)
  }

  return data
}
