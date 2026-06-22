export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')

  if (req.method === 'OPTIONS') {
    return res.status(200).end()
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const { phone, otp } = req.body

  if (!phone || !otp) {
    return res.status(400).json({ success: false, error: 'Phone aur OTP chahiye' })
  }

  const cleanPhone = phone.replace(/\D/g, '').replace(/^91/, '')

  if (cleanPhone.length !== 10) {
    return res.status(400).json({ success: false, error: 'Invalid phone number' })
  }

  const apiKey = process.env.FAST2SMS_API_KEY

  if (!apiKey) {
    return res.status(500).json({ success: false, error: 'API key missing' })
  }

  try {
    const response = await fetch('https://www.fast2sms.com/dev/bulkV2', {
      method: 'POST',
      headers: {
        'authorization': apiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        route: 'otp',
        variables_values: otp,
        numbers: cleanPhone,
        flash: 0,
      }),
    })

    const data = await response.json()

    console.log('Fast2SMS response:', JSON.stringify(data))

    if (data.return === true) {
      return res.status(200).json({
        success: true,
        message: 'OTP bhej diya',
        requestId: data.request_id,
      })
    } else {
      return res.status(400).json({
        success: false,
        message: data.message || 'SMS nahi gaya',
        details: data,
      })
    }
  } catch (error) {
    console.error('Fast2SMS error:', error)
    return res.status(500).json({ success: false, error: error.message })
  }
}
