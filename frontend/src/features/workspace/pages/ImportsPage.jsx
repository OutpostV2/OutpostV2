import {
  EmptyState,
  PageHeading,
  PreviewNotice,
} from '../components/WorkspaceUI'
export default function ImportsPage() {
  return (
    <>
      <PageHeading
        eyebrow="Coordinator / Imports"
        title="Student imports"
        description="Prepare roster data for a cohort and review each import before it becomes part of the workspace."
      />
      <PreviewNotice>
        Upload, validation, preview, and commit controls will be enabled when
        the import API is built.
      </PreviewNotice>
      <EmptyState
        title="No imports yet"
        description="There is no roster import endpoint connected to this frontend. This page is reserved for the upload and validation workflow in the build guide."
      />
    </>
  )
}
