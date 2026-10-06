import { z } from "zod";
import * as AuthData from "@/features/auth/data/auth.data";
import * as ConfigService from "@/features/config/service/config.service";
import { createEmailMessageFromNotification } from "@/features/email/service/email-message.mapper";
import type {
  NotificationDelivery,
  NotificationEvent,
} from "@/features/notification/notification.schema";
import {
  ADMIN_NOTIFICATION_EVENTS,
  notificationEventSchema,
  USER_NOTIFICATION_EVENTS,
} from "@/features/notification/notification.schema";
import { serverEnv } from "@/lib/env/server.env";

function isAdminNotificationEvent(
  event: NotificationEvent,
): event is Extract<
  NotificationEvent,
  { type: (typeof ADMIN_NOTIFICATION_EVENTS)[number] }
> {
  return ADMIN_NOTIFICATION_EVENTS.some((type) => type === event.type);
}

function isUserNotificationEvent(
  event: NotificationEvent,
): event is Extract<
  NotificationEvent,
  { type: (typeof USER_NOTIFICATION_EVENTS)[number] }
> {
  return USER_NOTIFICATION_EVENTS.some((type) => type === event.type);
}

function configuredWebhookEndpoint(
  config: Awaited<ReturnType<typeof ConfigService.getSystemConfig>>,
) {
  const url = config?.notification?.webhook?.url?.trim() ?? "";
  const secret = config?.notification?.webhook?.secret?.trim() ?? "";
  if (!url || !secret || !z.url().safeParse(url).success) return null;
  return { url, secret };
}

async function enqueueEmailNotification(
  context: DbContext,
  event: NotificationEvent,
  delivery: NotificationDelivery,
  emailSignature?: string, // ✅ 新增参数
) {
  const emailMessage = createEmailMessageFromNotification(
    event,
    serverEnv(context.env).LOCALE,
    delivery,
    emailSignature, // ✅ 传进去
  );
  await context.env.QUEUE.send({
    type: "EMAIL",
    data: emailMessage,
  });
}

async function enqueueWebhookNotification(
  context: DbContext,
  event: Extract<
    NotificationEvent,
    { type: (typeof ADMIN_NOTIFICATION_EVENTS)[number] }
  >,
  endpoint: { url: string; secret: string },
) {
  await context.env.QUEUE.send({
    type: "WEBHOOK",
    data: {
      url: endpoint.url,
      secret: endpoint.secret,
      event,
    },
  });
}

export async function publishNotificationEvent(
  context: DbContext & { executionCtx: ExecutionContext },
  event: NotificationEvent,
  delivery?: NotificationDelivery,
) {
  const parsed = notificationEventSchema.parse(event);
  const config = await ConfigService.getSystemConfig(context);
  const adminEmailEnabled =
    config?.notification?.admin?.channels?.email ?? true;
  const userEmailEnabled = config?.notification?.user?.emailEnabled ?? true;
  const webhookEndpoint = configuredWebhookEndpoint(config);

  // ✅ 新增：从配置里把签名提取出来
  const emailSignature = config?.email?.emailSignature;

  if (isUserNotificationEvent(parsed)) {
    if (!userEmailEnabled || !delivery?.to) {
      return;
    }

    // ✅ 修改：传 emailSignature
    await enqueueEmailNotification(context, parsed, delivery, emailSignature);
    console.log(
      JSON.stringify({
        level: "info",
        message: "Notification published",
        eventType: parsed.type,
        deliveries: { email: true },
      }),
    );
    return;
  }

  if (isAdminNotificationEvent(parsed)) {
    const deliveries: Array<Promise<void>> = [];
    let emailed = false;

    if (adminEmailEnabled) {
      const to = delivery?.to ?? (await AuthData.findAdminEmail(context.db));
      if (to) {
        deliveries.push(
          // ✅ 修改：传 emailSignature
          enqueueEmailNotification(
            context,
            parsed,
            {
              to,
              unsubscribeUrl: delivery?.unsubscribeUrl,
            },
            emailSignature, // ✅ 第四个参数
          ),
        );
        emailed = true;
      }
    }

    if (webhookEndpoint) {
      deliveries.push(
        enqueueWebhookNotification(context, parsed, webhookEndpoint),
      );
    }

    console.log(
      JSON.stringify({
        level: "info",
        message: "Notification published",
        eventType: parsed.type,
        deliveries: {
          email: emailed,
          webhook: Boolean(webhookEndpoint),
        },
      }),
    );
    await Promise.all(deliveries);
    return;
  }

  parsed satisfies never;
}