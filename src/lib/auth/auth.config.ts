import { apiKey } from "@better-auth/api-key";
import type { BetterAuthOptions } from "better-auth";
import { admin } from "better-auth/plugins";
// 👇 根据你项目的实际路径导入 sendEmail
import { sendEmail } from "@/features/email/service/email.service";

// 👇 接收 context
export function createAuthConfig(context: any) {
  return {
    rateLimit: {
      enabled: false, // 关掉“短时间多次注册”的限制
    },

    // 👇 新增：绑定注册发信逻辑
    emailVerification: {
      sendOnSignUp: true, // 注册后自动发送验证邮件
      sendVerificationEmail: async ({ user, url }) => {
        await sendEmail(context, {
          to: user.email,
          subject: "验证您的邮箱", // 如果你有国际化需求，可以使用 m.xxx 替换
          html: `
            <p>欢迎注册！</p>
            <p>请点击下方链接完成邮箱验证：</p>
            <p><a href="${url}">${url}</a></p>
            <p>如果这不是您的操作，请忽略此邮件。</p>
          `,
        });
      },
    },

    emailAndPassword: {
      enabled: true,
    },
    session: {
      storeSessionInDatabase: true,
      cookieCache: {
        enabled: true,
        maxAge: 5 * 60,
      },
    },
    user: {
      additionalFields: {
        mutedAt: {
          type: "date",
          required: false,
          input: false,
        },
      },
    },
    plugins: [
      admin(),
      apiKey({
        enableSessionForAPIKeys: true,
        requireName: true,
        defaultPrefix: "fsb_",
        rateLimit: { enabled: false },
        keyExpiration: {
          defaultExpiresIn: null,
          disableCustomExpiresTime: true,
        },
      }),
    ],
  } satisfies BetterAuthOptions;
}