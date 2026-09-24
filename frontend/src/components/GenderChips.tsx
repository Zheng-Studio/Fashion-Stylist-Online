import { GENDER_LABEL, GENDERS } from "../constants";

// 性别选择 chips（单品表单与「我」共用）。
// 再点已选中项即取消（value 回到空串）——四处原本就是这个行为。
export default function GenderChips({
  value,
  onChange,
  disabled,
}: {
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
}) {
  return (
    <div className="chips">
      {GENDERS.map((g) => (
        <button
          key={g}
          type="button"
          className={value === g ? "chip on" : "chip"}
          onClick={() => onChange(value === g ? "" : g)}
          disabled={disabled}
        >
          {GENDER_LABEL[g] ?? g}
        </button>
      ))}
    </div>
  );
}
