import path from "node:path";
import { describe, expect, it } from "vitest";
import { acharRamo, lerFaixasIdade, lerRamos } from "@/config";

process.env.GARIMPO_RAIZ = path.resolve(__dirname, "..");
const { ramos } = lerRamos();
const rotulo = (cnae: string) => acharRamo(cnae, ramos)?.rotulo;

describe("config/ramos.json", () => {
  it("dá o rótulo da especialidade, não o do grupo", () => {
    expect(rotulo("8650003")).toBe("Psicologia");
    expect(rotulo("8650004")).toBe("Fisioterapia");
    expect(rotulo("8650099")).toBe("Profissional de saúde");
    expect(rotulo("8690904")).toBe("Podologia");
  });

  it("dentista sem cirurgia não vira consultório médico", () => {
    expect(rotulo("8630504")).toBe("Consultório odontológico");
    expect(rotulo("8630505")).toBe("Consultório odontológico");
    expect(rotulo("8630503")).toBe("Clínica ou consultório médico");
  });

  it("deixa de fora os ramos de trabalhador pejotizado", () => {
    for (const cnae of ["6201501", "5320202", "7319002", "4930201", "8219999"]) {
      expect(acharRamo(cnae, ramos), cnae).toBeUndefined();
    }
  });

  it("config/nota.json tem faixas de idade em ordem crescente", () => {
    const faixas = lerFaixasIdade();
    expect(faixas.length).toBeGreaterThan(0);
    for (let i = 1; i < faixas.length; i++) expect(faixas[i]!.ateMeses).toBeGreaterThan(faixas[i - 1]!.ateMeses);
  });

  it("não tem prefixo repetido nem peso fora de 10/20", () => {
    const prefixos = ramos.map((r) => r.prefixo);
    expect(new Set(prefixos).size).toBe(prefixos.length);
    for (const r of ramos) expect([10, 20], r.prefixo).toContain(r.peso);
  });
});
