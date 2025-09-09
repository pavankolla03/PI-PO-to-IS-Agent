import { useState } from "react";
import JSZip from "jszip";

interface IInterface {
  id?: string;
  sender?: string;
  receiver?: string;
  adapter?: string;
  modules?: string[];
  mappings?: IMapping[];
}

interface IMapping {
  name?: string; // for .zip/tpz
  path?: string; // for .zip/tpz
  snippet?: string; // for .zip/tpz
  source?: string; // for XML
  target?: string; // for XML
  program?: string; // for XML
}

interface IPartner {
  id?: string;
  name?: string;
  contact?: string;
}

interface ICert {
  alias?: string;
  subject?: string;
  validFrom?: string;
  validTo?: string;
}

// Removes XML namespaces
function removeNamespaces(xmlString: string): string {
  return xmlString
    .replace(/xmlns(:\w+)?="[^"]*"/g, "")
    .replace(/(<\/?)[a-zA-Z0-9]+:/g, "$1");
}

export default function App() {
  const [rawFiles, setRawFiles] = useState<string[]>([]);
  const [parsed, setParsed] = useState<{
    interfaces: IInterface[];
    mappings: IMapping[];
    partners: IPartner[];
    certs: ICert[];
  }>({ interfaces: [], mappings: [], partners: [], certs: [] });
  const [logs, setLogs] = useState<string[]>([]);

  function log(msg: string) {
    setLogs((l) => [...l, `[${new Date().toLocaleTimeString()}] ${msg}`]);
  }

  async function handleFiles(e: React.ChangeEvent<HTMLInputElement>) {
    const files = e.target.files ? Array.from(e.target.files) : [];
    setRawFiles(files.map((f) => f.name));
    setLogs([]);
    const results = {
      interfaces: [] as IInterface[],
      mappings: [] as IMapping[],
      partners: [] as IPartner[],
      certs: [] as ICert[],
    };

    for (const f of files) {
      log(`Processing: ${f.name}`);
      const name = f.name.toLowerCase();
      try {
        if (name.endsWith(".xml") && name.includes("ico")) {
          const text = await f.text();
          const { interfaces, partners, certs, mappings } = parseICOFile(text);
          results.interfaces.push(...interfaces);
          results.partners.push(...partners);
          results.certs.push(...certs);
          results.mappings.push(...mappings);
          log(
            `Parsed ${interfaces.length} interfaces, ${partners.length} partners, ${certs.length} certificates, ${mappings.length} mappings from ${f.name}`
          );
        } else if (name.endsWith(".tpz") || name.endsWith(".zip")) {
          const arrayBuffer = await f.arrayBuffer();
          const zip = await JSZip.loadAsync(arrayBuffer);
          const mappings = await parseTpzMappings(zip);
          results.mappings.push(...mappings);
          log(`Extracted ${mappings.length} mappings from ${f.name}`);
        } else if (name.includes("b2b") || name.includes("partner")) {
          const text = await f.text();
          const partners = parseB2BXml(text);
          results.partners.push(...partners);
          log(`Parsed ${partners.length} partners from ${f.name}`);
        } else if (name.endsWith(".crt") || name.endsWith(".pem")) {
          const text = await f.text();
          const certs = parseCerts(text);
          results.certs.push(...certs);
          log(`Parsed ${certs.length} certs from ${f.name}`);
        } else {
          log(`Unknown file type for ${f.name} — skipped`);
        }
      } catch (err: any) {
        log(`Error processing ${f.name}: ${err.message}`);
      }
    }

    setParsed(results);
    log("Parsing complete.");
  }

  // Parse ICO XML and extract all needed entities, including mappings inside each ICO
  function parseICOFile(xmlText: string): {
    interfaces: IInterface[];
    partners: IPartner[];
    certs: ICert[];
    mappings: IMapping[];
  } {
    const cleanXML = removeNamespaces(xmlText);
    const xmlDoc = new DOMParser().parseFromString(cleanXML, "application/xml");

    // Partners
    const partners: IPartner[] = Array.from(
      xmlDoc.getElementsByTagName("Partner")
    ).map((p) => ({
      id: p.getElementsByTagName("ID")[0]?.textContent ?? "",
      name: p.getElementsByTagName("Name")[0]?.textContent ?? "",
      contact: p.getElementsByTagName("Contact")[0]?.textContent ?? "",
    }));

    // Certificates
    const certs: ICert[] = Array.from(
      xmlDoc.getElementsByTagName("Certificate")
    ).map((c) => ({
      alias: c.getElementsByTagName("Alias")[0]?.textContent ?? "",
      subject: c.getElementsByTagName("Subject")[0]?.textContent ?? "",
      validFrom: c.getElementsByTagName("ValidFrom")[0]?.textContent ?? "",
      validTo: c.getElementsByTagName("ValidTo")[0]?.textContent ?? "",
    }));

    // ICO / IntegratedConfiguration with mappings extraction
    const icos = Array.from(
      xmlDoc.getElementsByTagName("IntegratedConfiguration")
    ).map((ico) => {
      // Mappings inside ICO
      const mappings: IMapping[] = Array.from(
        ico.getElementsByTagName("Mapping")
      ).map((m) => ({
        source: m.getElementsByTagName("Source")[0]?.textContent ?? "",
        target: m.getElementsByTagName("Target")[0]?.textContent ?? "",
        program: m.getElementsByTagName("Program")[0]?.textContent ?? "",
      }));

      return {
        id: ico.getAttribute("id") ?? "",
        sender: ico.getElementsByTagName("Party")[0]?.textContent ?? "",
        receiver: ico.getElementsByTagName("Party")[1]?.textContent ?? "",
        adapter: ico.getElementsByTagName("Adapter")[0]?.textContent ?? "",
        modules: Array.from(ico.getElementsByTagName("Module")).map(
          (m) => m.textContent ?? ""
        ),
        mappings,
      };
    });

    // Also collect all mappings for global display table
    const allMappings: IMapping[] = [];
    icos.forEach((ico) => {
      if (ico.mappings && ico.mappings.length > 0)
        allMappings.push(
          ...ico.mappings.map((m) => ({
            ...m,
            name: `[ICO] ${ico.id}`,
          }))
        );
    });

    // Legacy <ICO> tag support, no mappings expected here
    const altIcos = Array.from(xmlDoc.getElementsByTagName("ICO")).map((ico) => ({
      id: ico.getAttribute("id") ?? ico.getAttribute("name") ?? "",
      sender:
        ico.querySelector("SenderParty")?.getAttribute("name") ||
        ico.querySelector("SenderComponent")?.getAttribute("name") ||
        "",
      receiver:
        ico.querySelector("ReceiverParty")?.getAttribute("name") ||
        ico.querySelector("ReceiverComponent")?.getAttribute("name") ||
        "",
      adapter: ico.querySelector("Adapter")?.textContent ?? "",
      modules: Array.from(ico.querySelectorAll("Module")).map(
        (m) => m.textContent || ""
      ),
      mappings: [],
    }));

    return {
      interfaces: [...icos, ...altIcos],
      partners,
      certs,
      mappings: allMappings,
    };
  }

  // For TPZ/zip mapping extracts
  async function parseTpzMappings(zip: JSZip): Promise<IMapping[]> {
    const mappings: IMapping[] = [];
    await Promise.all(
      Object.keys(zip.files).map(async (path) => {
        if (path.toLowerCase().includes("mapping")) {
          try {
            const txt = await zip.files[path].async("string");
            mappings.push({
              name: path.split("/").pop(),
              path,
              snippet: txt.slice(0, 200),
            });
          } catch {
            /* skip */
          }
        }
      })
    );
    return mappings;
  }

  function parseB2BXml(text: string): IPartner[] {
    const cleanXML = removeNamespaces(text);
    const doc = new DOMParser().parseFromString(cleanXML, "application/xml");
    return Array.from(doc.getElementsByTagName("Partner")).map((p) => ({
      id: p.getAttribute("id") || "",
      name: p.getAttribute("name") || "",
      contact: p.getElementsByTagName("Contact")[0]?.textContent ?? "",
    }));
  }

  function parseCerts(text: string): ICert[] {
    const regex =
      /-----BEGIN CERTIFICATE-----(.*?)-----END CERTIFICATE-----/gs;
    const certs: ICert[] = [];
    let match;
    let idx = 0;
    while ((match = regex.exec(text)) !== null) {
      certs.push({ alias: `pem-${idx++}`, subject: match[0].slice(0, 50) });
    }
    return certs;
  }

  return (
    <div className="p-6 max-w-5xl mx-auto font-sans">
      <h1 className="text-2xl font-bold mb-4">PI/PO → CPI Extraction Tool</h1>
      <input type="file" multiple onChange={handleFiles} className="mb-4" />

      <h2 className="font-semibold">Files:</h2>
      <ul className="list-disc ml-6 mb-4">
        {rawFiles.map((f) => (
          <li key={f}>{f}</li>
        ))}
      </ul>

      <h2 className="font-semibold">Interfaces:</h2>
      <ul className="list-disc ml-6 mb-4">
        {parsed.interfaces.map((i, idx) => (
          <li key={idx}>
            {i.id}{" "}
            {i.sender || i.receiver ? `(${i.sender} → ${i.receiver})` : ""}
            {i.mappings && i.mappings.length > 0
              ? ` [${i.mappings.length} mapping(s)]`
              : ""}
          </li>
        ))}
      </ul>

      <h2 className="font-semibold">Mappings:</h2>
      <ul className="list-disc ml-6 mb-4">
        {parsed.mappings.map((m, idx) => (
          <li key={idx}>
            {m.name && m.name.startsWith("[ICO]")
              ? `${m.name} — ${m.source || ""} → ${m.target || ""} (${m.program || ""})`
              : m.name // For .tpz
                ? `${m.name}`
                : `${m.source || ""} → ${m.target || ""}`}
          </li>
        ))}
      </ul>

      <h2 className="font-semibold">Partners:</h2>
      <ul className="list-disc ml-6 mb-4">
        {parsed.partners.map((p, idx) => (
          <li key={idx}>
            {p.name}
            {p.contact ? ` – ${p.contact}` : ""}
          </li>
        ))}
      </ul>

      <h2 className="font-semibold">Certificates:</h2>
      <ul className="list-disc ml-6 mb-4">
        {parsed.certs.map((c, idx) => (
          <li key={idx}>
            {c.alias}
            {c.subject ? ` – ${c.subject}` : ""}
            {c.validFrom && c.validTo
              ? ` (${c.validFrom} to ${c.validTo})`
              : ""}
          </li>
        ))}
      </ul>

      <h2 className="font-semibold">Logs:</h2>
      <pre className="bg-gray-100 p-2 rounded text-sm max-h-40 overflow-y-auto">
        {logs.join("\n")}
      </pre>
    </div>
  );
}
