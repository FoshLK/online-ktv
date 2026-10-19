import { Injectable, Logger } from "@nestjs/common";
import nodemailer from "nodemailer";

export type MailDelivery = "smtp" | "development-log";

@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);

  async sendVerificationCode(email: string, code: string): Promise<MailDelivery> {
    const authCode = process.env.SMTP_AUTH_CODE;
    if (!authCode) {
      if (process.env.NODE_ENV === "production") throw new Error("SMTP_AUTH_CODE is required in production");
      this.logger.warn(`[development mailbox] ${email} verification code: ${code}`);
      return "development-log";
    }

    const transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST ?? "smtp.qq.com",
      port: Number(process.env.SMTP_PORT ?? 465),
      secure: (process.env.SMTP_SECURE ?? "true") === "true",
      auth: {
        user: process.env.SMTP_USER,
        pass: authCode,
      },
    });

    await transporter.sendMail({
      from: `"${process.env.SMTP_FROM_NAME ?? "线上KTV"}" <${process.env.SMTP_USER}>`,
      to: email,
      subject: "线上KTV 邮箱验证码",
      text: `你的验证码是 ${code}，15 分钟内有效。若不是你本人操作，请忽略本邮件。`,
      html: `<div style="font-family:Arial,'Microsoft YaHei',sans-serif;color:#26232b"><h2>线上KTV 邮箱验证</h2><p>你的验证码是：</p><div style="font-size:30px;font-weight:700;letter-spacing:8px;color:#7044d8">${code}</div><p>验证码 15 分钟内有效。若不是你本人操作，请忽略本邮件。</p></div>`,
    });
    return "smtp";
  }
}
