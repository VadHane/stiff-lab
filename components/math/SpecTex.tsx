import { Tex } from "@/components/ui/Tex";
import {
  specDefsTex,
  specInitialTex,
  specJacobianTex,
  specParamsTex,
  specSystemTex,
  validateSpec,
  type ProblemSpec,
  type SpecValues,
} from "@/lib/problem-spec";

/**
 * Система рівнянь зі специфікації в KaTeX: `\begin{cases} … \end{cases}`, допоміжні величини («де …»),
 * параметри, початкові умови й відрізок, за бажанням — якобіан.
 *
 * @param substitute  підставити числа замість імен параметрів (зі `values` або типові)
 * @param show        які частини показати (типово: system, defs, params, initial)
 */
export default function SpecTex({
  spec,
  values,
  substitute = false,
  show = { system: true, defs: true, params: true, initial: true, jacobian: false },
  className,
}: {
  spec: ProblemSpec;
  values?: SpecValues;
  substitute?: boolean;
  show?: { system?: boolean; defs?: boolean; params?: boolean; initial?: boolean; jacobian?: boolean };
  className?: string;
}) {
  const { errors } = validateSpec(spec);
  if (errors.length)
    return (
      <div className={`rounded-xl border border-[#ff5d73]/40 bg-[#ff5d73]/10 p-3 text-[13px] text-white/80 ${className ?? ""}`}>
        Систему не можна показати: {errors[0].message}
      </div>
    );
  const opts = { substitute, values };
  const defs = show.defs ? specDefsTex(spec, opts) : [];
  const params = show.params && !substitute && spec.params.length ? specParamsTex(spec, values) : "";
  return (
    <div className={className}>
      {show.system !== false && <Tex block>{specSystemTex(spec, opts)}</Tex>}
      {defs.length > 0 && <Tex block>{`\\text{де}\\quad ${defs.join(",\\quad ")}`}</Tex>}
      {params && <Tex block>{params}</Tex>}
      {show.initial && <Tex block>{specInitialTex(spec, values)}</Tex>}
      {show.jacobian && <Tex block>{specJacobianTex(spec, opts)}</Tex>}
    </div>
  );
}
