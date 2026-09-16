import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Plus, Trash2 } from "lucide-react";

/** Общая «оболочка» поля редактора: подпись, содержимое, подсказка. */
export function FieldShell({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <Label className="text-sm font-medium leading-snug">{label}</Label>
      {children}
      {hint && (
        <p className="text-xs text-muted-foreground/90 leading-relaxed">
          {hint}
        </p>
      )}
    </div>
  );
}

/** Список коротких строк с кнопками «добавить пункт» и «удалить пункт». */
export function ListInput({
  label,
  hint,
  items,
  placeholder,
  onChange,
}: {
  label: string;
  hint?: string;
  items: string[];
  placeholder?: string;
  onChange: (items: string[]) => void;
}) {
  return (
    <FieldShell label={label} hint={hint}>
      <div className="space-y-2">
        {items.map((item, index) => (
          <div key={index} className="flex items-center gap-2">
            <Input
              value={item}
              placeholder={placeholder}
              onChange={(event) =>
                onChange(
                  items.map((value, i) =>
                    i === index ? event.target.value : value,
                  ),
                )
              }
            />
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="shrink-0"
              title="Удалить пункт"
              onClick={() => onChange(items.filter((_, i) => i !== index))}
            >
              <Trash2 className="h-4 w-4 text-muted-foreground" />
            </Button>
          </div>
        ))}
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => onChange([...items, ""])}
        >
          <Plus className="mr-1.5 h-4 w-4" />
          Добавить пункт
        </Button>
      </div>
    </FieldShell>
  );
}
