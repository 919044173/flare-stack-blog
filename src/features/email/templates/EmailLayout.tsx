import type { ReactNode } from "react";
import { blogConfig } from "@/blog.config";
import type { Locale } from "@/lib/i18n";

interface EmailLayoutProps {
  children: ReactNode;
  locale?: Locale;
  previewText?: string;
}

export const EmailLayout = ({
  children,
  locale,
  previewText,
}: EmailLayoutProps) => {
  return (
    <div
      lang={locale}
      style={{
        backgroundColor: "#ffffff",
        fontFamily:
          '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif, "Apple Color Emoji", "Segoe UI Emoji", "Segoe UI Symbol"',
        margin: "0",
        padding: "0",
        width: "100%",
      }}
    >
      {previewText && (
        <div
          style={{
            display: "none",
            maxHeight: "0px",
            overflow: "hidden",
          }}
        >
          {previewText}
        </div>
      )}
      <table
        align="center"
        border={0}
        cellPadding="0"
        cellSpacing="0"
        width="100%"
        style={{
          maxWidth: "600px",
          margin: "0 auto",
          padding: "30px 16px", // 调整为 30px 上下，16px 左右，手机上更好看
        }}
      >
        <tr>
          <td>
            <header style={{ marginBottom: "40px", textAlign: "center" }}>
              <h2
                style={{
                  fontFamily: '"Noto Serif SC", "Songti SC", Georgia, serif',
                  fontSize: "24px",
                  fontWeight: "500",
                  margin: "0",
                  letterSpacing: "-0.01em",
                }}
              >
                {blogConfig.title}
              </h2>
            </header>

            <main>{children}</main>

            {/* ================= 邮件签名区 开始 ================= */}
            <div
              style={{
                marginTop: "48px",
                paddingTop: "24px",
                borderTop: "1px solid #eaeaea", // 淡灰色分割线
              }}
            >
              <p
                style={{
                  margin: "0 0 8px 0",
                  fontSize: "14px",
                  fontWeight: "600",
                  color: "#1a1a1a",
                }}
              >
                {blogConfig.author}
              </p>
              <p
                style={{
                  margin: "0 0 8px 0",
                  fontSize: "12px",
                  color: "#888888",
                  lineHeight: "1.6",
                }}
              >
                {blogConfig.description}
              </p>
              <p style={{ margin: "0", fontSize: "12px" }}>
                <a
                  href="https://ryn.us.ci"
                  style={{
                    color: "#1a1a1a",
                    textDecoration: "underline",
                    textUnderlineOffset: "2px",
                  }}
                >
                  ryn.us.ci
                </a>
              </p>
            </div>
            {/* ================= 邮件签名区 结束 ================= */}

            <footer
              style={{
                marginTop: "24px", // 因为签名区已经占了间距，底部版权可以稍微紧凑一点
                paddingTop: "16px",
                borderTop: "1px solid #f0f0f0",
                textAlign: "center",
              }}
            >
              <p
                style={{
                  fontSize: "11px",
                  color: "#aaaaaa",
                  margin: "0",
                  letterSpacing: "0.05em",
                  textTransform: "uppercase",
                }}
              >
                &copy; {new Date().getUTCFullYear()} {blogConfig.title}.
              </p>
            </footer>
          </td>
        </tr>
      </table>
    </div>
  );
};