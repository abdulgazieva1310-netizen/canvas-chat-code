import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createMemoryHistory, createRootRoute, createRoute, createRouter, Outlet, RouterProvider } from "@tanstack/react-router";
import { afterEach, expect, it, vi } from "vitest";
import { Api } from "@/lib/api/client";
import { Route as StudyRoute } from "@/routes/study";
import { SaveQuestionButton } from "@/components/SaveQuestionButton";
vi.mock("@/components/AppShell",()=>({AppShell:({children}:any)=><div>{children}</div>}));
afterEach(()=>{cleanup();vi.restoreAllMocks();});
const item={id:"saved",interviewId:"interview",questionId:"question",prompt:"<script>question</script>",note:"Original",savedAt:"2026-10-20T00:00:00Z"};
function open() {
  const client=new QueryClient({defaultOptions:{queries:{retry:false}}});
  const root=createRootRoute({component:Outlet});
  const route=createRoute({getParentRoute:()=>root,path:"/study",component:StudyRoute.options.component!});
  const router=createRouter({routeTree:root.addChildren([route]),history:createMemoryHistory({initialEntries:["/study"]})});
  render(<QueryClientProvider client={client}><RouterProvider router={router}/></QueryClientProvider>);
  return client;
}
it("loads notes, safely renders text, retains failed edits and supports retry/removal",async()=>{
  const listing=vi.spyOn(Api,"getStudyQuestions").mockResolvedValue({items:[item],total:1,page:1,pageSize:20});
  const update=vi.spyOn(Api,"updateStudyQuestion").mockRejectedValueOnce(new Error("offline")).mockResolvedValue({...item,note:"Русский <b>note</b>"});
  vi.spyOn(Api,"deleteStudyQuestion").mockImplementation(async()=>{listing.mockResolvedValue({items:[],total:0,page:1,pageSize:20});});
  const client=open();
  const input=await screen.findByLabelText("Private note");
  expect(screen.getByText(item.prompt)).toBeVisible();
  expect(document.querySelector("script")).toBeNull();
  fireEvent.change(input,{target:{value:"Русский <b>note</b>"}});
  fireEvent.click(screen.getByRole("button",{name:"Save note"}));
  await screen.findByRole("alert");
  expect(input).toHaveValue("Русский <b>note</b>");
  fireEvent.click(screen.getByRole("button",{name:"Save note"}));
  await screen.findByText("Note saved.");
  expect(update).toHaveBeenLastCalledWith("saved","Русский <b>note</b>");
  fireEvent.click(screen.getByRole("button",{name:"Remove saved question"}));
  await screen.findByText("No saved questions on this page.");
  client.clear();
});
it("paginates and retries listing failures",async()=>{
  const listing=vi.spyOn(Api,"getStudyQuestions").mockRejectedValueOnce(new Error("offline"))
    .mockResolvedValueOnce({items:[item],total:21,page:1,pageSize:20})
    .mockResolvedValue({items:[{...item,id:"last",prompt:"Last question"}],total:21,page:2,pageSize:20});
  const client=open();
  await screen.findByRole("alert");
  fireEvent.click(screen.getByRole("button",{name:"Retry"}));
  await screen.findByLabelText("Private note");
  fireEvent.click(screen.getByRole("button",{name:"Next page"}));
  await screen.findByText("Last question");
  expect(listing).toHaveBeenLastCalledWith(2);
  expect(screen.getByRole("button",{name:"Next page"})).toBeDisabled();
  client.clear();
});
it("saves reported questions with pending and failure recovery",async()=>{
  let finish!:(value:typeof item)=>void;
  const save=vi.spyOn(Api,"saveStudyQuestion").mockRejectedValueOnce(new Error("offline"))
    .mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;}));
  const client=new QueryClient();
  render(<QueryClientProvider client={client}><SaveQuestionButton interviewId="interview" questionId="question"/></QueryClientProvider>);
  fireEvent.click(screen.getByRole("button"));
  await screen.findByRole("alert");
  fireEvent.click(screen.getByRole("button"));
  expect(await screen.findByRole("button",{name:"Saving question…"})).toBeDisabled();
  finish(item);
  await waitFor(()=>expect(screen.getByRole("button",{name:"Question saved"})).toBeDisabled());
  expect(save).toHaveBeenLastCalledWith("interview","question");
  client.clear();
});
