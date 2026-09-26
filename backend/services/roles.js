/**
 * Work the participant says they can do on their own, asked at the end of the
 * exam. Admins can replace the list per exam (config.roles).
 */
const DEFAULT_ROLES = [
  ['taep', 'TAEP processing', 'TAEP प्रक्रिया'],
  ['baep', 'BAEP processing', 'BAEP प्रक्रिया'],
  ['taep_print', 'Printing of TAEP', 'TAEP की प्रिंटिंग'],
  ['baep_print', 'Printing of BAEP', 'BAEP की प्रिंटिंग'],
  ['paper_pass', 'Paper pass', 'पेपर पास'],
  ['kronos', 'Kronos enrollment', 'Kronos नामांकन'],
  ['card_encoding', 'Card encoding and issuing', 'कार्ड एन्कोडिंग और जारी करना'],
  ['avp', 'Vehicle pass (AVP)', 'वाहन पास (AVP)'],
  ['visitor_pass', 'Visitor / temporary entry pass', 'विज़िटर / अस्थायी प्रवेश पास'],
  ['pass_return', 'Pass return, cancellation and lost pass cases', 'पास वापसी, रद्दीकरण और खोए पास के मामले'],
  ['document_check', 'Document verification', 'दस्तावेज़ सत्यापन'],
  ['bgc', 'BGC (background check) processing', 'BGC (पृष्ठभूमि जाँच) प्रक्रिया'],
  ['pvr', 'Police verification (PVR) follow-up', 'पुलिस सत्यापन (PVR) फ़ॉलो-अप'],
  ['avsec_training', 'AVSEC training', 'AVSEC प्रशिक्षण'],
  ['tot', 'TOT (Training of Trainers)', 'TOT (प्रशिक्षकों का प्रशिक्षण)'],
  ['ao', 'AO', 'AO'],
  ['fees', 'Fee collection and receipts', 'शुल्क संग्रह और रसीद'],
  ['records', 'Records, registers and data entry', 'रिकॉर्ड, रजिस्टर और डेटा एंट्री'],
  ['reports', 'Reports and MIS', 'रिपोर्ट और MIS'],
  ['helpdesk', 'Help desk / applicant queries', 'हेल्प डेस्क / आवेदक के प्रश्न'],
  ['supervision', 'Supervising the counter / shift', 'काउंटर / शिफ्ट का पर्यवेक्षण'],
].map(([key, en, hi]) => ({ key, en, hi }));

function rolesFor(exam) {
  const list = exam && exam.config && Array.isArray(exam.config.roles) && exam.config.roles.length ? exam.config.roles : DEFAULT_ROLES;
  return list;
}

/** "English | Hindi" lines (admin editor) → role list. */
function parseRoleLines(lines) {
  const seen = new Set();
  return lines
    .map((line) => String(line || '').split('|').map((x) => x.trim()))
    .filter(([en]) => en)
    .map(([en, hi]) => {
      let key = en.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 40) || 'role';
      while (seen.has(key)) key += '_';
      seen.add(key);
      return { key, en: en.slice(0, 120), hi: (hi || '').slice(0, 120) };
    })
    .slice(0, 60);
}

module.exports = { DEFAULT_ROLES, rolesFor, parseRoleLines };
