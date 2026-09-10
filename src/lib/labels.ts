import { LICENSE_OPTIONS } from '@/config';
import { t, type Locale } from '@/i18n';
import type { AuthLabels } from '@/lib/auth-dialog';
import type { CardLabels } from '@/lib/ui';
import type { CollectionLabels } from '@/lib/views/collection';
import type { DetailLabels } from '@/lib/views/detail';
import type { DiscussionsLabels } from '@/lib/views/discussions';
import type { EditorLabels } from '@/lib/views/editor';
import type { UserLabels } from '@/lib/views/user';

/** 卡片渲染文案 */
export function buildCardLabels(locale: Locale): CardLabels {
  return {
    paramsWith: t(locale, 'params.with'),
    paramsTuned: t(locale, 'params.tuned'),
    paramsNone: t(locale, 'params.none'),
  };
}

/** 集合详情页文案 */
export function buildCollectionLabels(locale: Locale): CollectionLabels {
  return {
    ...buildCardLabels(locale),
    submit: t(locale, 'collection.submit'),
    edit: t(locale, 'collection.edit'),
    delete: t(locale, 'collection.delete'),
    save: t(locale, 'collection.save'),
    cancel: t(locale, 'common.cancel'),
    deleteConfirmText: t(locale, 'collection.deleteConfirmText'),
    deleteSubmissionTitle: t(locale, 'collection.deleteSubmissionTitle'),
    deleteSubmissionHint: t(locale, 'collection.deleteSubmissionHint'),
    deleteStepFiles: t(locale, 'collection.deleteStepFiles'),
    deleteStepRelease: t(locale, 'collection.deleteStepRelease'),
    deleteStepIndex: t(locale, 'collection.deleteStepIndex'),
    deleteFailed: t(locale, 'collection.deleteFailed'),
    deleteRetry: t(locale, 'editor.retry'),
    deleteDone: t(locale, 'collection.deleteDone'),
    loginRequired: t(locale, 'collection.loginRequired'),
    login: t(locale, 'nav.login'),
    license: t(locale, 'label.license'),
    stars: t(locale, 'label.stars'),
    user: t(locale, 'label.user'),
  };
}

/** 稿件详情页文案 */
export function buildDetailLabels(locale: Locale): DetailLabels {
  return {
    ...buildCardLabels(locale),
    date: t(locale, 'label.date'),
    edit: t(locale, 'collection.edit'),
    tracks: t(locale, 'label.tracks'),
    engines: t(locale, 'label.engines'),
    voicebanks: t(locale, 'label.voicebanks'),
    songLanguages: t(locale, 'label.songLanguages'),
    videos: t(locale, 'label.videos'),
    media: t(locale, 'detail.media'),
    files: t(locale, 'detail.files'),
    release: t(locale, 'detail.release'),
    comments: t(locale, 'detail.comments'),
    download: t(locale, 'detail.download'),
    decrypt: t(locale, 'detail.decrypt'),
    password: t(locale, 'detail.password'),
    encrypted: t(locale, 'detail.encrypted'),
    decrypted: t(locale, 'detail.decrypted'),
    compressed: t(locale, 'detail.compressed'),
    attachments: t(locale, 'detail.attachments'),
    interactions: t(locale, 'detail.interactions'),
    like: t(locale, 'detail.like'),
    liked: t(locale, 'detail.liked'),
    commentsDisabled: t(locale, 'detail.commentsDisabled'),
    noComments: t(locale, 'detail.noComments'),
    viewIssue: t(locale, 'detail.viewIssue'),
    gotoRelease: t(locale, 'detail.gotoRelease'),
    delete: t(locale, 'detail.delete'),
    commentPh: t(locale, 'detail.commentPh'),
    commentSubmit: t(locale, 'detail.commentSubmit'),
    commentFailed: t(locale, 'detail.commentFailed'),
    loginToComment: t(locale, 'detail.loginToComment'),
    loadError: t(locale, 'detail.loadError'),
    deleted: t(locale, 'detail.deleted'),
    deletedHint: t(locale, 'detail.deletedHint'),
    back: t(locale, 'detail.back'),
    viewCollection: t(locale, 'detail.viewCollection'),
    viewUser: t(locale, 'detail.viewUser'),
    sourceRepo: t(locale, 'detail.sourceRepo'),
    license: t(locale, 'label.license'),
    stars: t(locale, 'label.stars'),
  };
}

/** 讨论页文案 */
export function buildDiscussionsLabels(locale: Locale): DiscussionsLabels {
  return {
    title: t(locale, 'discussions.title'),
    description: t(locale, 'discussions.description'),
    open: t(locale, 'discussions.open'),
    newDiscussion: t(locale, 'discussions.newDiscussion'),
    newDiscussionTitle: t(locale, 'discussions.newDiscussionTitle'),
    newDiscussionTarget: t(locale, 'discussions.newDiscussionTarget'),
    fieldTitle: t(locale, 'discussions.fieldTitle'),
    fieldCategory: t(locale, 'discussions.fieldCategory'),
    fieldBody: t(locale, 'discussions.fieldBody'),
    newDiscussionSubmit: t(locale, 'discussions.newDiscussionSubmit'),
    cancel: t(locale, 'common.cancel'),
    errDiscussionTitle: t(locale, 'discussions.errTitle'),
    errDiscussionBody: t(locale, 'discussions.errBody'),
    createDiscussionFailed: t(locale, 'discussions.createFailed'),
    loginFirst: t(locale, 'discussions.loginFirst'),
    none: t(locale, 'discussions.none'),
    loadError: t(locale, 'discussions.loadError'),
    comments: t(locale, 'common.comments'),
    viewOriginal: t(locale, 'discussions.viewOriginal'),
    reply: t(locale, 'discussions.reply'),
    replyPlaceholder: t(locale, 'discussions.replyPlaceholder'),
    replySubmit: t(locale, 'discussions.replySubmit'),
    replyPosting: t(locale, 'editor.publishing'),
    replySuccess: t(locale, 'discussions.replySuccess'),
    replyFailed: t(locale, 'discussions.replyFailed'),
    replyLoginHint: t(locale, 'discussions.replyLoginHint'),
    back: t(locale, 'discussions.back'),
  };
}

/** 个人主页文案 */
export function buildUserLabels(locale: Locale): UserLabels {
  return {
    space: t(locale, 'user.title'),
    projects: t(locale, 'user.projects'),
    articles: t(locale, 'user.articles'),
    more: t(locale, 'user.more'),
    newCollection: t(locale, 'user.newCollection'),
    site: t(locale, 'user.site'),
    about: t(locale, 'user.about'),
    noRepos: t(locale, 'user.noRepos'),
    prefix: t(locale, 'user.prefix'),
    repoName: t(locale, 'user.repoName'),
    owner: t(locale, 'user.owner'),
    template: t(locale, 'user.template'),
    templateNone: t(locale, 'user.templateNone'),
    license: t(locale, 'user.license'),
    licenseNone: t(locale, 'user.licenseNone'),
    licenseCustom: t(locale, 'user.licenseCustom'),
    licenseCustomPh: t(locale, 'user.licenseCustomPh'),
    licenseCustomRequired: t(locale, 'user.licenseCustomRequired'),
    create: t(locale, 'user.create'),
    creating: t(locale, 'user.creating'),
    cancel: t(locale, 'common.cancel'),
    created: t(locale, 'user.created'),
    createFailed: t(locale, 'user.createFailed'),
    nameRequired: t(locale, 'user.nameRequired'),
  };
}

/** 登录授权指引文案 */
export function buildAuthLabels(locale: Locale): AuthLabels {
  return {
    title: t(locale, 'auth.title'),
    intro: t(locale, 'auth.intro'),
    platform: t(locale, 'editor.platform'),
    loggedIn: t(locale, 'auth.loggedIn'),
    logout: t(locale, 'nav.logout'),
    tokenHint: t(locale, 'auth.tokenHint'),
    faqLink: t(locale, 'nav.faq'),
    tokenPh: t(locale, 'editor.tokenPh'),
    tokenSave: t(locale, 'editor.tokenSave'),
    tokenBad: t(locale, 'editor.tokenBad'),
    demoHint: t(locale, 'auth.demoHint'),
    cancel: t(locale, 'common.cancel'),
    oauthLogin: t(locale, 'auth.oauthLogin'),
    deviceLogin: t(locale, 'auth.deviceLogin'),
    oauthUnavailable: t(locale, 'auth.oauthUnavailable'),
  };
}

/** 许可证下拉选项（客户端渲染表单，需按当前语言翻译） */
export function buildLicenseOptions(locale: Locale): { value: string; label: string }[] {
  return LICENSE_OPTIONS.map((option) => ({
    value: option.value,
    label: option.labelKey ? t(locale, option.labelKey) : (option.label ?? option.value),
  }));
}

/** 编辑器页面的标签对象 */
export function buildEditorLabels(locale: Locale): EditorLabels {
  return {
    demoBanner: t(locale, 'editor.demoBanner'),
    repo: t(locale, 'editor.repo'),
    slug: t(locale, 'editor.slug'),
    typeLabel: t(locale, 'editor.typeLabel'),
    titleLabel: t(locale, 'editor.titleLabel'),
    author: t(locale, 'editor.author'),
    email: t(locale, 'editor.email'),
    titlePh: t(locale, 'editor.titlePh'),
    videos: t(locale, 'editor.videos'),
    add: t(locale, 'editor.add'),
    remove: t(locale, 'editor.remove'),
    limitHint: t(locale, 'editor.limitHint'),
    params: t(locale, 'editor.params'),
    cover: t(locale, 'editor.cover'),
    coverChoose: t(locale, 'editor.coverChoose'),
    coverReplace: t(locale, 'editor.coverReplace'),
    coverRemove: t(locale, 'editor.coverRemove'),
    body: t(locale, 'editor.body'),
    write: t(locale, 'editor.write'),
    preview: t(locale, 'editor.preview'),
    tagsLabel: t(locale, 'editor.tagsLabel'),
    tagsPh: t(locale, 'editor.tagsPh'),
    files: t(locale, 'editor.files'),
    filesHint: t(locale, 'editor.filesHint'),
    fileTooLarge: t(locale, 'editor.fileTooLarge'),
    scheme: t(locale, 'editor.scheme'),
    schemeRaw: t(locale, 'editor.schemeRaw'),
    schemeFormat: t(locale, 'editor.schemeFormat'),
    schemeZip: t(locale, 'editor.schemeZip'),
    schemeEncrypt: t(locale, 'editor.schemeEncrypt'),
    attachments: t(locale, 'editor.attachments'),
    summary: t(locale, 'editor.summary'),
    commentSection: t(locale, 'editor.commentSection'),
    submittedAt: t(locale, 'editor.submittedAt'),
    publishedAt: t(locale, 'editor.publishedAt'),
    attachmentChoose: t(locale, 'editor.attachmentChoose'),
    attachmentsGithubHint: t(locale, 'editor.attachmentsGithubHint'),
    attachmentsGithubSummaryHint: t(locale, 'editor.attachmentsGithubSummaryHint'),
    existing: t(locale, 'editor.existing'),
    license: t(locale, 'label.license'),
    licenseNone: t(locale, 'editor.licenseNone'),
    licenseCustom: t(locale, 'editor.licenseCustom'),
    licenseCustomPh: t(locale, 'editor.licenseCustomPh'),
    authRequired: t(locale, 'editor.authRequired'),
    platform: t(locale, 'editor.platform'),
    tokenPh: t(locale, 'editor.tokenPh'),
    tokenSave: t(locale, 'editor.tokenSave'),
    tokenBad: t(locale, 'editor.tokenBad'),
    submit: t(locale, 'editor.submit'),
    save: t(locale, 'editor.save'),
    publishing: t(locale, 'editor.publishing'),
    stepIssue: t(locale, 'editor.stepIssue'),
    stepFiles: t(locale, 'editor.stepFiles'),
    stepReadme: t(locale, 'editor.stepReadme'),
    stepRelease: t(locale, 'editor.stepRelease'),
    stepAssets: t(locale, 'editor.stepAssets'),
    stepIndex: t(locale, 'editor.stepIndex'),
    stepCover: t(locale, 'editor.stepCover'),
    stepSkipped: t(locale, 'editor.stepSkipped'),
    retry: t(locale, 'editor.retry'),
    skipStep: t(locale, 'editor.skipStep'),
    redirectIn: t(locale, 'editor.redirectIn'),
    goNow: t(locale, 'editor.goNow'),
    cancelRedirect: t(locale, 'editor.cancelRedirect'),
    doneNew: t(locale, 'editor.doneNew'),
    doneEdit: t(locale, 'editor.doneEdit'),
    gotoCollection: t(locale, 'editor.gotoCollection'),
    gotoSubmission: t(locale, 'editor.gotoSubmission'),
    errTitle: t(locale, 'editor.errTitle'),
    errSlug: t(locale, 'editor.errSlug'),
    errSlugPattern: t(locale, 'editor.errSlugPattern'),
    errRepo: t(locale, 'editor.errRepo'),
    errPassword: t(locale, 'editor.errPassword'),
    errCoverType: t(locale, 'editor.errCoverType'),
    errLoad: t(locale, 'editor.errLoad'),
    typeProject: t(locale, 'type.project'),
    typeArticle: t(locale, 'type.article'),
    paramsWith: t(locale, 'params.with'),
    paramsTuned: t(locale, 'params.tuned'),
    paramsNone: t(locale, 'params.none'),
    tracks: t(locale, 'label.tracks'),
    engines: t(locale, 'label.engines'),
    voicebanks: t(locale, 'label.voicebanks'),
    songLanguages: t(locale, 'label.songLanguages'),
  };
}
