// priors لكل قطاع: قيم افتراضية للسوق و cagr وأمثلة منافسين
export type SectorKey = 'health' | 'tourism' | 'fintech' | 'education' | 'retail'

export const SECTOR_PRIORS: Record<SectorKey, {
  sampleCAGR: number;               // % نمو سنوي مركب افتراضي
  baseMarketUSD: number;            // حجم سوق تقريبي اليوم (مليون$)
  unitEconomicsNote: string;        // ملاحظة اقتصادية
  typicalRoles: Array<{role:string; min:number; max:number}>
  milestones: string[];             // محطات جاهزة تُدمج في الخارطة
  risks: string[];
}> = {
  health: {
    sampleCAGR: 0.18, baseMarketUSD: 52000,
    unitEconomicsNote: 'اشتراكات SaaS B2B + تكامل مع التأمين',
    typicalRoles: [
      { role: 'PM/Owner', min: 1, max: 2 },
      { role: 'Tech Lead/Architect', min: 1, max: 1 },
      { role: 'Frontend (Web/Mobile)', min: 2, max: 4 },
      { role: 'Backend/API', min: 2, max: 4 },
      { role: 'ML/AI Engineer', min: 1, max: 2 },
      { role: 'QA/Automation', min: 1, max: 2 },
      { role: 'Designer (UX/UI)', min: 1, max: 2 },
      { role: 'DevOps/SecOps', min: 1, max: 1 },
    ],
    milestones: ['اكتشاف المتطلبات', 'PoC تنظيمي وأمن بيانات',
      'MVP تجريبي مع عيادة/مستشفى', 'تكامل التأمين/السجلات',
      'إطلاق محدود', 'إطلاق عام مع مراقبة جودة'],
    risks: ['الامتثال والخصوصية', 'جودة البيانات', 'تكامل الجهات'],
  },
  tourism: {
    sampleCAGR: 0.14, baseMarketUSD: 25000,
    unitEconomicsNote: 'عمولة على الحجوزات + إعلانات + اشتراكات مزودين',
    typicalRoles: [
      { role:'PM',min:1,max:1},{role:'Frontend',min:2,max:4},
      { role:'Backend',min:2,max:3},{role:'ML/Reco',min:1,max:2},
      { role:'Designer',min:1,max:1},{role:'QA',min:1,max:2},{role:'DevOps',min:1,max:1}
    ],
    milestones:['أبحاث المستخدم','MVP توصيات/حجز','شراكات مزودين','إطلاق تجريبي','تحسين التحويل','التوسع الإقليمي'],
    risks:['موسمية الطلب','جات/بوابات دفع','جودة المحتوى'],
  },
  fintech: {
    sampleCAGR: 0.20, baseMarketUSD: 65000,
    unitEconomicsNote: 'عمولة معاملات + اشتراكات شركات',
    typicalRoles:[
      {role:'PM',min:1,max:2},{role:'Backend',min:3,max:5},
      {role:'Security/Compliance',min:1,max:2},{role:'Mobile',min:2,max:4},
      {role:'Data/ML',min:1,max:2},{role:'QA',min:1,max:2},{role:'DevOps',min:1,max:1}
    ],
    milestones:['تراخيص/امتثال','MVP مدفوعات','شراكات بنوك','إطلاق محدود','مراقبة احتيال','التوسّع'],
    risks:['تنظيم وامتثال','مكافحة الاحتيال','أمان'],
  },
  education: {
    sampleCAGR: 0.12, baseMarketUSD: 18000,
    unitEconomicsNote:'اشتراكات مدارس/أفراد + محتوى مدفوع',
    typicalRoles:[
      {role:'PM',min:1,max:1},{role:'Frontend',min:2,max:3},{role:'Backend',min:2,max:3},
      {role:'ML/Adaptive',min:1,max:2},{role:'Designer',min:1,max:1},{role:'QA',min:1,max:1}
    ],
    milestones:['محتوى تعليمي','MVP تكيفي','تجارب مدارس','إطلاق محدود','لوحات أولياء الأمور','التوسّع'],
    risks:['فعالية التعلم','تباين المناهج','تحفيز المستخدم'],
  },
  retail: {
    sampleCAGR: 0.10, baseMarketUSD: 40000,
    unitEconomicsNote:'عمولة/اشتراك البائع + توصيات',
    typicalRoles:[
      {role:'PM',min:1,max:1},{role:'Frontend',min:2,max:3},{role:'Backend',min:2,max:3},
      {role:'ML/Recommender',min:1,max:2},{role:'Designer',min:1,max:1},{role:'QA',min:1,max:1},{role:'DevOps',min:1,max:1}
    ],
    milestones:['كتالوج منتجات','MVP سلة/دفع','شراكات مزودين','إطلاق محدود','تحسين تسعير','التوسع'],
    risks:['لوجستيات','عائدات','عشرات المزودين'],
  },
}
