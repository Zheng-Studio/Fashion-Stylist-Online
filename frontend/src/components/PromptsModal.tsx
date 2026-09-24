import type { DressStep } from "../types";
import Modal from "./Modal";

// 实际发给生图接口的换装提示词——点一下才看，调试用
export default function PromptsModal({
  prompts,
  onClose,
}: {
  prompts: DressStep[];
  onClose: () => void;
}) {
  return (
    <Modal
      className="inspector-modal promo-modal"
      bodyClassName="inspector-body"
      title="换装提示词（实际发给生图接口）"
      onClose={onClose}
      closeOnEscape
    >
      {prompts.map((p, i) => (
        <section className="sec" key={i}>
          <h4 className="sec-h">
            {prompts.length > 1 ? `${i + 1}. ` : ""}
            {p.item}
          </h4>
          <pre className="sec-pre">{p.prompt}</pre>
        </section>
      ))}
    </Modal>
  );
}
