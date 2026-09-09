import { useEffect, useState } from "react";
import {
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import Constants from "expo-constants";
import { api } from "../api";
import { colors } from "../theme";

interface Props {
  onBack: () => void;
}

/** Телефоны/режим работы по умолчанию — подставятся, если контент не загрузился. */
const DEFAULT_PHONE = "+7 (905) 629-87-08";
const DEFAULT_PHONE_HREF = "tel:+79056298708";
const DEFAULT_HOURS = "Пн-Пт: 9:00 - 18:00";

/**
 * «О приложении»: версия, канал обновлений, контакты службы и сайт.
 * Контакты берутся из админки (те же, что на сайте), а не захардкожены.
 */
export function AboutScreen({ onBack }: Props) {
  const [phone, setPhone] = useState(DEFAULT_PHONE);
  const [phoneHref, setPhoneHref] = useState(DEFAULT_PHONE_HREF);
  const [hours, setHours] = useState(DEFAULT_HOURS);
  const [requisites, setRequisites] = useState("");

  useEffect(() => {
    (async () => {
      try {
        const data = await api.getContent();
        const items = data?.content?.contact?.items;
        if (items) {
          const tel = items.find((i) => i.title === "Телефон");
          if (tel) {
            setPhone(tel.value);
            setPhoneHref(
              tel.href || `tel:${tel.value.replace(/[^+\d]/g, "")}`,
            );
          }
          const work = items.find((i) => i.title === "Режим работы");
          if (work) setHours(work.value);
        }
        const requisitesText = data?.content?.footer?.requisites;
        if (requisitesText) setRequisites(requisitesText);
      } catch {
        // Контент не загрузился — остаются значения по умолчанию
      }
    })();
  }, []);

  const version = Constants.expoConfig?.version ?? "1.0.0";
  // runtimeVersion может быть строкой (хеш сборки) или политикой — показываем только строку
  const runtime =
    typeof Constants.expoConfig?.runtimeVersion === "string"
      ? (Constants.expoConfig.runtimeVersion as string)
      : null;

  return (
    <SafeAreaView style={styles.root}>
      <View style={styles.header}>
        <Pressable onPress={onBack} hitSlop={12} style={styles.backButton}>
          <Text style={styles.backText}>← Назад</Text>
        </Pressable>
        <Text style={styles.headerTitle}>О приложении</Text>
        <View style={styles.headerSpacer} />
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.logoWrap}>
          <View style={styles.logoCircle}>
            <Text style={styles.logoText}>71</Text>
          </View>
          <Text style={styles.appName}>Обзор71 — Админ</Text>
          <Text style={styles.appDesc}>
            Домофонная служба · ИП Бухтеев
          </Text>
        </View>

        <View style={styles.card}>
          <View style={styles.infoRow}>
            <Text style={styles.infoLabel}>Версия</Text>
            <Text style={styles.infoValue}>{version}</Text>
          </View>
          {runtime ? (
            <View style={styles.infoRow}>
              <Text style={styles.infoLabel}>Сборка</Text>
              <Text style={styles.infoValue} numberOfLines={1}>
                {runtime.slice(0, 10)}…
              </Text>
            </View>
          ) : null}
          <View style={styles.infoRow}>
            <Text style={styles.infoLabel}>Сайт</Text>
            <Pressable onPress={() => Linking.openURL("https://obzor71.ru")} hitSlop={8}>
              <Text style={styles.link}>obzor71.ru</Text>
            </Pressable>
          </View>
        </View>

        <Text style={styles.sectionTitle}>Контакты службы</Text>
        <View style={styles.card}>
          <View style={styles.infoRow}>
            <Text style={styles.infoLabel}>Телефон</Text>
            <Pressable onPress={() => Linking.openURL(phoneHref)} hitSlop={8}>
              <Text style={styles.link}>{phone}</Text>
            </Pressable>
          </View>
          <View style={styles.infoRow}>
            <Text style={styles.infoLabel}>Режим работы</Text>
            <Text style={styles.infoValue}>{hours}</Text>
          </View>
          {requisites ? (
            <View style={styles.infoRow}>
              <Text style={styles.infoLabel}>Реквизиты</Text>
              <Text style={styles.infoValue}>{requisites}</Text>
            </View>
          ) : null}
        </View>

        <Text style={styles.footnote}>
          Заявки с сайта и сообщения чата синхронизируются автоматически.
          При проблемах со связью данные копятся на устройстве и отправляются,
          как только интернет появится.
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.background,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.cardBorder,
    backgroundColor: colors.card,
  },
  backButton: {
    paddingVertical: 4,
    paddingRight: 12,
  },
  backText: {
    color: colors.primary,
    fontSize: 15,
    fontWeight: "600",
  },
  headerTitle: {
    color: colors.text,
    fontSize: 20,
    fontWeight: "800",
  },
  headerSpacer: {
    width: 70,
  },
  content: {
    padding: 20,
    gap: 14,
  },
  logoWrap: {
    alignItems: "center",
    gap: 6,
    paddingVertical: 10,
  },
  logoCircle: {
    width: 84,
    height: 84,
    borderRadius: 42,
    backgroundColor: colors.primary,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 4,
  },
  logoText: {
    color: colors.primaryForeground,
    fontSize: 30,
    fontWeight: "900",
  },
  appName: {
    color: colors.text,
    fontSize: 19,
    fontWeight: "800",
  },
  appDesc: {
    color: colors.textMuted,
    fontSize: 13,
  },
  sectionTitle: {
    color: colors.textMuted,
    fontSize: 12,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 0.6,
    marginTop: 4,
  },
  card: {
    backgroundColor: colors.card,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    paddingHorizontal: 14,
    paddingVertical: 4,
  },
  infoRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    paddingVertical: 11,
    borderBottomWidth: 1,
    borderBottomColor: colors.cardBorder,
  },
  infoLabel: {
    color: colors.textMuted,
    fontSize: 14,
    flexShrink: 0,
  },
  infoValue: {
    color: colors.text,
    fontSize: 14,
    fontWeight: "600",
    flex: 1,
    textAlign: "right",
  },
  link: {
    color: colors.primary,
    fontSize: 14,
    fontWeight: "700",
    flex: 1,
    textAlign: "right",
  },
  footnote: {
    color: colors.textMuted,
    fontSize: 12,
    lineHeight: 17,
    textAlign: "center",
    opacity: 0.85,
    paddingHorizontal: 8,
  },
});