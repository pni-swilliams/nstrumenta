import { APIEndpoint, withAuth } from '../authentication'
import { firestore } from '../authentication/ServiceAccount'





export interface GetDataMountArgs {
  projectId: string
}

const getDataMountBase: APIEndpoint<GetDataMountArgs> = async (
  req,
  res,
  args,
) => {
  const { projectId } = args

  try {
    console.log('getDataMount', { projectId })
    const projectPath = `projects/${projectId}`
    const project = await (await firestore.doc(projectPath).get()).data()

    const bucket = project?.bucket
    return res.status(200).send({ bucket, projectId })
  } catch (error) {
    res.status(500).send(`Something went wrong`)
  }
}

export const getDataMount = withAuth(getDataMountBase)
