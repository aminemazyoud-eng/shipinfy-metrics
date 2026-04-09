import nodemailer from 'nodemailer'

export const transporter = nodemailer.createTransport({
  host:   process.env.SMTP_HOST   ?? 'smtp.gmail.com',
  port:   parseInt(process.env.SMTP_PORT ?? '465'),
  secure: (process.env.SMTP_PORT ?? '465') === '465',
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
})
