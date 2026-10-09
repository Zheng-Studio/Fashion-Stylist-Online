import { GENDER_LABEL, GENDERS } from "../constants";

// 单品适用性别选择 chips。
// 再点已选中项即取消（value 回到空串）。
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
