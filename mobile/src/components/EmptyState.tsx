import { StyleSheet, Text, View } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import { colors } from "../theme";

interface Props {
  /** Имя иконки Ionicons (например, "clipboard-outline"). */
  iconName: string;
  /** Цвет иконки (по умолчанию приглушённый). */
  iconColor?: string;
  /** Главный заголовок («Заявок пока нет»). */
  title: string;
  /** Подсказка, что делать дальше (необязательно). */
  hint?: string;
}

/** Красивое пустое состояние: иконка Ionicons в мягком круге + заголовок + подсказка. */
export function EmptyState({ iconName, iconColor, title, hint }: Props) {
  return (
    <View style={styles.wrap}>
      <View style={styles.iconCircle}>
        <Ionicons
          name={iconName as any}
          size={34}
          color={iconColor ?? colors.textMuted}
        />
      </View>
      <Text style={styles.title}>{title}</Text>
      {hint ? <Text style={styles.hint}>{hint}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 32,
    gap: 8,
  },
  iconCircle: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: colors.inputBg,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 8,
  },
  title: {
    color: colors.text,
    fontSize: 16,
    fontWeight: "700",
    textAlign: "center",
  },
  hint: {
    color: colors.textMuted,
    fontSize: 13,
    textAlign: "center",
    lineHeight: 18,
    opacity: 0.85,
    maxWidth: 260,
  },
});